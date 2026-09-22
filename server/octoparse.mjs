// Octoparse cloud runs are asynchronous. Accepted is never treated as product data.
// Use AgentTools for bounded task creation and the current MCP Storage contract
// for exports; the older /data/all endpoint excludes the free MCP allowance.
import { budgetFetch } from "./search-budget.mjs";
import { randomUUID } from "node:crypto";
const sessions = new Map();

function providerError(code = "search_unavailable") {
  return Object.assign(new Error("Octoparse request could not be completed"), { code });
}

function failureCode(message) {
  if (/task_quantity_limit_reached|task quantity limit reached/i.test(message)) return "task_limit_reached";
  if (/quota|allowance|insufficient.*(?:credit|record)|credit.*exhaust/i.test(message)) return "quota_exhausted";
  return "search_unavailable";
}

export function decodeRpc(body, id) {
  const messages = body.trim().startsWith("{") ? [JSON.parse(body)] : body.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    return data ? [JSON.parse(data)] : [];
  });
  const message = messages.find(item => item.id === id);
  if (!message || message.error || message.result?.isError) {
    const failure = JSON.stringify(message?.error ?? message?.result ?? {});
    throw providerError(failureCode(failure));
  }
  const result = message.result;
  const value = result?.structuredContent ?? (result?.content?.find(item => item.type === "text") ? JSON.parse(result.content.find(item => item.type === "text").text) : result);
  if (value?.success === false) throw providerError(failureCode(JSON.stringify(value)));
  return value;
}

export async function octoparseTool(name, args, apiKey, fetcher = budgetFetch) {
  if (!apiKey) throw providerError("provider_not_configured");
  const headers = { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json, text/event-stream" };
  const send = async (method, params, id) => {
    const response = await fetcher("https://mcp.octoparse.com", { method: "POST", headers, signal: AbortSignal.timeout(12000), body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }) });
    if (!response.ok) {
      sessions.delete(apiKey);
      throw providerError(response.status === 429 ? "provider_rate_limited" : "search_unavailable");
    }
    return response;
  };
  let session = sessions.get(apiKey);
  if (!session || session.expires < Date.now()) {
    const initializeId = randomUUID();
    const response = await send("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ShopNearMe", version: "1.0" } }, initializeId);
    session = { id: response.headers.get("mcp-session-id"), expires: Date.now() + 300000 };
    decodeRpc(await response.text(), initializeId);
    if (!session.id) throw providerError();
    headers["mcp-session-id"] = session.id;
    await send("notifications/initialized", {});
    sessions.set(apiKey, session);
  } else headers["mcp-session-id"] = session.id;
  // Concurrent exports share a session. Reusing id=2 can route one task's
  // response to another task (for example map rows to the product parser).
  const requestId = randomUUID();
  const response = await send("tools/call", { name, arguments: args }, requestId);
  return decodeRpc(await response.text(), requestId);
}

export async function startOctoparseTask(templateName, parameters, taskName, apiKey, maxRows = 20, fetcher = budgetFetch) {
  if (!apiKey) throw providerError("provider_not_configured");
  const response = await fetcher("https://openapi.octoparse.com/api/agentTools/executeTask", {
    method: "POST", signal: AbortSignal.timeout(12000),
    headers: { "x-api-key": apiKey, "x-external-user-id": "shopnearme", "accept-language": "en-US", "content-type": "application/json" },
    body: JSON.stringify({ templateName, parameters: JSON.stringify(parameters), taskName, targetMaxRows: Math.min(20, Math.max(1, maxRows)) }),
  });
  const body = await response.json();
  const data = body.data;
  if (!response.ok || !data?.success || !data.taskId || !data.lotNo) throw providerError(failureCode(`${data?.error} ${data?.message}`));
  // Preserve the lot as a string: it exceeds JavaScript's safe integer range.
  if (typeof data.lotNo !== "string" || !/^[1-9]\d{0,18}$/.test(data.lotNo)) throw providerError();
  return { taskId: data.taskId, lotNo: data.lotNo, status: "pending", nextPollAt: Date.now() + Math.max(1, data.retryGuidance?.waitSecondsMin ?? 60) * 1000 };
}

export async function findOctoparseTask(taskName, apiKey, fetcher = budgetFetch, call = octoparseTool) {
  const params = new URLSearchParams({ page: "1", size: "5", keyword: taskName });
  const response = await fetcher(`https://openapi.octoparse.com/api/agentTools/searchTasks?${params}`, {
    headers: { "x-api-key": apiKey, "x-external-user-id": "shopnearme" }, signal: AbortSignal.timeout(8000),
  });
  const body = await response.json();
  // Lookup failure must not be mistaken for absence: that could duplicate a job.
  if (!response.ok || !body.data?.success || !Array.isArray(body.data.tasks)) throw providerError();
  const match = body.data.tasks.find(task => task.taskName === taskName);
  if (!match) return null;
  const state = await call("get_task_status", { taskId: match.taskId }, apiKey);
  if (!state.success || !state.lotNo) throw providerError();
  return { taskId: state.taskId, lotNo: state.lotNo, status: "pending", nextPollAt: state.status === "running" ? Date.now() + 60000 : 0 };
}

export async function readOctoparseTask(task, apiKey, call = octoparseTool) {
  if (Date.now() < task.nextPollAt) return { ...task, rows: [] };
  const state = await call("get_task_status", { taskId: task.taskId }, apiKey);
  if (!state.success || state.lotNo !== task.lotNo) throw providerError();
  if (state.status === "running" || state.status === "unexecuted") return { ...task, status: "pending", nextPollAt: Date.now() + 60000, rows: [] };
  if (state.status !== "completed" && state.status !== "stopped") throw providerError();
  if (!state.collectedRows) return { ...task, status: "empty", rows: [] };
  const exported = await call("export_data", { taskId: task.taskId, lotNo: task.lotNo, page: 1, pageSize: 20 }, apiKey);
  if (!exported.success || !Array.isArray(exported.data)) throw providerError();
  return { ...task, status: "completed", rows: exported.data };
}
