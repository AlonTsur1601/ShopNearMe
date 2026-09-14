import { AsyncLocalStorage } from "node:async_hooks";

const searches = new AsyncLocalStorage();
export function deadlineError() { return Object.assign(new Error("Search time limit reached. Results may be incomplete."), { code: "search_timeout", name: "TimeoutError" }); }
export function searchContext() { return searches.getStore(); }
export async function withSearchBudget(operation, milliseconds = 16000) {
  const controller = new AbortController();
  const context = { signal: controller.signal, deadline: Date.now() + milliseconds, providerFailure: null };
  const timer = setTimeout(() => controller.abort(deadlineError()), milliseconds);
  try { return await searches.run(context, operation); }
  finally { clearTimeout(timer); controller.abort(deadlineError()); }
}
export function budgetFetch(url, options = {}) {
  const context = searches.getStore();
  if (!context) return fetch(url, options);
  context.signal.throwIfAborted();
  const signal = options.signal ? AbortSignal.any([options.signal, context.signal]) : context.signal;
  return fetch(url, { ...options, signal });
}
