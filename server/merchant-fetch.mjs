import { createHash } from "node:crypto";
import { budgetFetch, searchContext } from "./search-budget.mjs";
import { enrichProductPage, extractProductData, isSearchResultsUrl } from "./product-page.mjs";

const cache = new Map();
const pending = new Map();

// At most three paid page reads per user search, after ordinary reads fail.
// Never substitute an indexed snippet or a store logo for verified product data.
export async function readMerchantProduct(url, config, deadline, direct = enrichProductPage) {
  const key = createHash("sha256").update(`${config.apiKey}|${config.productZone}|${url}`).digest("hex");
  const cached = cache.get(key);
  if (cached?.expires > Date.now()) return cached.page;
  if (pending.has(key)) return pending.get(key);
  const job = retrieveMerchantProduct(url, config, deadline, direct, key);
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}

async function retrieveMerchantProduct(url, config, deadline, direct, key) {
  const page = await direct(url);
  if (page.unavailable || page.isCatalog || page.availability === "Out of stock" || (page.isProduct && page.price > 0 && page.imageUrl)) return page;
  const context = searchContext();
  if (!config.apiKey || !config.productZone || !context || context.signal.aborted || Date.now() + 1500 >= deadline || (context.merchantFetchCount ?? 0) >= 3) return page;
  context.merchantFetchCount = (context.merchantFetchCount ?? 0) + 1;
  try {
    const response = await budgetFetch("https://api.brightdata.com/request", {
      method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone: config.productZone, url, format: "raw" }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))),
    });
    if (!response.ok) return { ...page, fetchErrorCode: response.status === 402 ? "quota_exhausted" : "merchant_unavailable" };
    const content = await response.text();
    // Accept the documented raw HTML and older JSON response envelopes.
    let html = content;
    if (content.trimStart().startsWith("{")) {
      const envelope = JSON.parse(content);
      if ([404, 410].includes(envelope.status_code)) return { unavailable: true };
      if (envelope.status_code !== 200 || typeof envelope.body !== "string") return { ...page, fetchErrorCode: "merchant_unavailable" };
      html = envelope.body;
    }
    html = html.slice(0, 2000000);
    const canonical = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']([^"']+))[\s\S]*?>/i)?.[1];
    const destination = new URL(canonical || url, url);
    // Do not accept an off-domain canonical or a redirect to search results.
    if (destination.hostname !== new URL(url).hostname || isSearchResultsUrl(destination.href)) return { isCatalog: true };
    if (/access denied|verify you are human|checking your browser/i.test(html.slice(0, 15000))) return { ...page, fetchErrorCode: "merchant_unavailable" };
    const recovered = extractProductData(html, destination.href);
    if (recovered.isProduct && !recovered.isCatalog && recovered.price > 0 && recovered.imageUrl) {
      if (cache.size >= 300) cache.delete(cache.keys().next().value);
      cache.set(key, { page: recovered, expires: Date.now() + 15 * 60 * 1000 });
    }
    return recovered;
  } catch (error) { return { ...page, fetchErrorCode: /Timeout|Abort/.test(error.name) ? "search_timeout" : "merchant_unavailable" }; }
}
