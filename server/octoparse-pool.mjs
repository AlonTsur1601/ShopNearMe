import { createHash } from "node:crypto";
import { budgetFetch } from "./search-budget.mjs";
import { octoparseTool } from "./octoparse.mjs";

// Reuse saved tasks through the same templateMapping contract as the official
// Octoparse CLI. executeTask creates a task and must never be a search fallback.
const api = "https://v2-clientapi.octoparse.com";
const templates = new Map();
const queues = new Map();
const leases = new Map();
const hash = value => createHash("sha256").update(value).digest("hex");
const failure = code => Object.assign(new Error("Octoparse could not complete the search"), { code });
const inputHash = input => hash(JSON.stringify(JSON.parse(input).TemplateParameters.sort((a, b) => a.ParamName.localeCompare(b.ParamName))));

export async function octoparseAccountRequest(path, apiKey, body, fetcher = budgetFetch) {
  if (!apiKey) throw failure("provider_not_configured");
  const response = await fetcher(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", "accept-language": "en-US" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok || (result.error && result.error !== "success")) {
    const message = String(result.error ?? "");
    throw failure(response.status === 401 ? "provider_authentication_failed" : /quota|credit|balance/i.test(message) ? "quota_exhausted" : "search_unavailable");
  }
  return result.data;
}

export function templateParameters(template, values) {
  const definitions = JSON.parse(template.parameters || "[]");
  const entries = Object.entries(values).map(([name, value]) => {
    const definition = definitions.find(item => item.ParamName === name || item.DisplayText === name);
    if (!definition) throw failure("invalid_template_parameters");
    return { definition, value };
  });
  const filled = value => value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 && value.every(item => String(item).trim()) : String(value).trim());
  if (definitions.some(item => item.IsRequired && !entries.some(entry => entry.definition.Id === item.Id && filled(entry.value)))) throw failure("invalid_template_parameters");
  return JSON.stringify({
    UIParameters: entries.map(({ definition, value }) => ({ Id: definition.Id, Value: value, Customize: { taskUrlType: 0, taskUrlRuleParam: [] } })),
    TemplateParameters: entries.map(({ definition, value }) => ({ ParamName: definition.ParamName, Value: value })),
  });
}

export async function reuseOctoparseTask(role, templateId, values, apiKey, dependencies = {}) {
  const request = dependencies.request ?? octoparseAccountRequest;
  const call = dependencies.call ?? octoparseTool;
  const fetcher = dependencies.fetcher ?? budgetFetch;
  const owner = hash(apiKey || "");
  const queueKey = `${owner}|${templateId}`;
  const previous = queues.get(queueKey) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const list = await request("/api/task/searchTaskListV3?pageIndex=1&pageSize=100&orderBy=4%262", apiKey);
    const candidates = (list?.dataList ?? []).filter(task => /^ShopNearMe\b/.test(task.taskName));
    const name = `ShopNearMe pool ${role}`;
    const leaseKey = task => `${owner}|${task.taskId}`;
    const running = task => task.taskExecuteStatus === 0;
    let task = candidates.find(item => item.taskName === name && item.templateId === templateId);
    task ??= candidates.find(item => item.templateId === templateId && !running(item) && !leases.has(leaseKey(item)) && !item.taskName.startsWith("ShopNearMe pool "));
    if (!task) throw failure("task_pool_unavailable");
    const lease = leaseKey(task);
    leases.set(lease, true);
    try {
      let template = templates.get(templateId);
      if (!template) {
        const response = await fetcher(`https://www.octoparse.com/api/v1/templateRegistration/${templateId}/currentTemplate`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(10000) });
        const result = await response.json();
        if (!response.ok || !result.data?.parameters) throw failure("invalid_template_parameters");
        template = result.data;
        templates.set(templateId, template);
      }
      const input = templateParameters(template, values);
      const current = await request(`/api/tasks/${task.taskId}/templateMapping`, apiKey);
      const state = await call("get_task_status", { taskId: task.taskId }, apiKey);
      const sameInput = current.userInputParameters && inputHash(current.userInputParameters) === inputHash(input);
      const ended = Date.parse(String(task.endExecuteTime ?? "") + (String(task.endExecuteTime ?? "").endsWith("Z") ? "" : "Z"));
      if (sameInput && state.lotNo && (state.status === "running" || (state.status === "completed" && state.collectedRows > 0 && Date.now() - ended < 900000))) {
        return { taskId: task.taskId, lotNo: state.lotNo, status: "pending", startedAt: Date.parse(task.startExecuteTime) || Date.now(), nextPollAt: state.status === "running" ? Date.now() + 15000 : 0, inputHash: inputHash(input), poolOwner: owner };
      }
      if (state.status === "running") throw failure("provider_busy");
      await request(`/api/tasks/${task.taskId}/templateMapping`, apiKey, {
        ...current, taskId: task.taskId, taskGroupId: task.taskGroupId, taskName: name,
        templateId, templateRegistrationId: templateId, templateVersionId: template.id,
        templateVersion: template.currentTemplateVersion ?? template.version, templateType: template.type,
        userInputParameters: input,
      });
      const checked = await request(`/api/tasks/${task.taskId}/templateMapping`, apiKey);
      if (inputHash(checked.userInputParameters) !== inputHash(input)) throw failure("provider_busy");
      const started = await call("start_or_stop_task", { taskId: task.taskId, action: "start" }, apiKey);
      if (!started.success || started.status === "already_running") throw failure("provider_busy");
      // start_requested is an acknowledgement, not a run identity. Octoparse
      // may not allocate the new lot until the worker has accepted the task.
      // Preserve the acknowledgement immediately. A second status request can
      // time out after start succeeded and otherwise lose the task identity.
      return { taskId: task.taskId, previousLot: state.lotNo, status: "pending", startedAt: Date.now(), nextPollAt: Date.now() + 15000, inputHash: inputHash(input), poolOwner: owner };
    } catch (error) { leases.delete(lease); throw error; }
  });
  queues.set(queueKey, operation);
  try { return await operation; } finally { if (queues.get(queueKey) === operation) queues.delete(queueKey); }
}

export async function readPoolTask(task, apiKey, dependencies = {}) {
  if (task.nextPollAt > Date.now()) return { ...task, rows: [] };
  const request = dependencies.request ?? octoparseAccountRequest;
  const call = dependencies.call ?? octoparseTool;
  let state;
  if ((["completed", "empty", "failed"].includes(task.status) || task.exportStatus) && task.lotNo) {
    // Completed lots are immutable. The task may already serve a later phase;
    // export the signed historical lot, never the task's newest dataset.
    state = { lotNo: task.lotNo, status: (task.exportStatus || task.status) === "failed" ? "stopped" : "completed", collectedRows: task.collectedRows || 0 };
  } else {
    const mapping = await request(`/api/tasks/${task.taskId}/templateMapping`, apiKey);
    if (task.inputHash && inputHash(mapping.userInputParameters) !== task.inputHash) throw failure("task_reassigned");
    state = await call("get_task_status", { taskId: task.taskId }, apiKey);
  }
  if (!task.lotNo && state.lotNo !== task.previousLot) task = { ...task, lotNo: state.lotNo };
  if (task.lotNo && state.lotNo && task.lotNo !== state.lotNo) throw failure("task_reassigned");
  if (!task.lotNo || state.status === "running" || state.status === "unexecuted") {
    if (task.startedAt && Date.now() - task.startedAt > 120000) {
      // Stop only a run whose input and exact lot were checked above. A hung
      // worker must not hold a shared task indefinitely or keep consuming rows.
      if (state.status === "running" && (!task.lotNo || task.lotNo === state.lotNo)) await call("start_or_stop_task", { taskId: task.taskId, action: "stop" }, apiKey);
      releaseOctoparseTask(task);
      if (!task.lotNo || !state.collectedRows) return { ...task, status: "failed", code: "search_timeout", rows: [] };
      // Preserve already collected products when just one worker is stalled.
      task = { ...task, code: "search_timeout" };
      state = { ...state, status: "stopped" };
    } else {
      return { ...task, status: "pending", nextPollAt: Date.now() + 15000, rows: [] };
    }
  }
  if (task.lotNo !== state.lotNo) throw failure("task_reassigned");
  if (!["completed", "stopped"].includes(state.status)) throw failure("search_unavailable");
  const rows = [];
  // Raw HTML rows can be hundreds of kilobytes each. A 50-row export timed
  // out even after extraction succeeded; use small concurrent exact-lot pages.
  const pageSize = 5, total = state.collectedRows;
  // Never label a truncated dataset complete. Our queries request small
  // batches; reject an unexpected oversized export instead of silently
  // discarding products or spending the user's allowance on unbounded reads.
  if (!Number.isInteger(total) || total < 0 || total > 100) throw failure("incomplete_export");
  for (let first = 1; first <= Math.ceil(total / pageSize); first += 4) {
    const exportedPages = await Promise.all(Array.from({ length: Math.min(4, Math.ceil(total / pageSize) - first + 1) }, (_, offset) => call("export_data", { taskId: task.taskId, lotNo: task.lotNo, page: first + offset, pageSize }, apiKey)));
    for (const exported of exportedPages) {
      if (!exported.success || !Array.isArray(exported.data)) throw failure("search_unavailable");
      rows.push(...exported.data);
    }
  }
  if (rows.length !== total) throw failure("incomplete_export");
  releaseOctoparseTask(task);
  return { ...task, exportStatus: undefined, collectedRows: state.collectedRows, status: state.status === "stopped" ? "failed" : rows.length ? "completed" : "empty", rows };
}

export function releaseOctoparseTask(task) {
  leases.delete(`${task.poolOwner}|${task.taskId}`);
}
