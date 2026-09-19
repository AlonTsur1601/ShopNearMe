import { createHash } from "node:crypto";
import { budgetFetch, searchContext } from "./search-budget.mjs";

const accounts = new Map();
export async function backupSearch(params, key, originalError) {
  const context = searchContext();
  if (!key || !context || context.backupUsed || context.signal.aborted || context.deadline - Date.now() < 3500) throw originalError;
  context.backupUsed = true; // At most one paid backup request per complete user search.
  const identity = createHash("sha256").update(key).digest("hex");
  let account = accounts.get(identity);
  if (!account || account.expires <= Date.now()) {
    const response = await budgetFetch("https://serpapi.com/account.json?" + new URLSearchParams({ api_key: key }), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw originalError;
    const data = await response.json();
    if (!Number.isFinite(data.total_searches_left)) throw originalError;
    account = { remaining: data.total_searches_left, reset: data.plan_renewal_date, expires: Date.now() + 600000 };
    if (accounts.size >= 20) accounts.delete(accounts.keys().next().value);
    accounts.set(identity, account);
  }
  if (account.remaining <= 0) {
    context.backupQuota = { reset: /^\d{4}-\d{2}-\d{2}$/.test(account.reset ?? "") ? account.reset : undefined };
    throw originalError;
  }
  account.remaining--;
  const query = new URLSearchParams(params);
  query.set("api_key", key);
  const response = await budgetFetch("https://serpapi.com/search.json?" + query, { signal: AbortSignal.timeout(Math.min(4000, context.deadline - Date.now())) });
  const result = await response.json();
  if (!response.ok || result.error || !Array.isArray(result.organic_results)) throw originalError;
  return result;
}
