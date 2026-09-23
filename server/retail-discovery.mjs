import { createHash } from "node:crypto";
import { brightDataSearch } from "./brightdata.mjs";
import { backupSearch } from "./backup-search.mjs";
import { readMerchantProduct } from "./merchant-fetch.mjs";
import { searchRetailerSites } from "./retailer-sites.mjs";
import { duckduckgoProducts } from "./duckduckgo.mjs";
import { catalogProductLinks } from "./catalog-products.mjs";
import { deadlineError, searchContext } from "./search-budget.mjs";
import { isSearchResultsUrl, productImageUrl } from "./product-page.mjs";

// Discovery yields URLs, never offers. Each URL must pass merchant-page validation.
// Independent engines begin together; fast results start validation immediately.
// No per-product SERP requests, retry loop, or dependency on a Maps response.
function merchantUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (/(^|\.)(?:google\.[a-z.]+|bing\.com|ebay\.[a-z.]+|youtube\.com|facebook\.com|instagram\.com|pinterest\.[a-z.]+|wikipedia\.org|maps\.apple\.com|zap\.co\.il|easy\.co\.il|mapcarta\.com|infobel\.com|atly\.com)$/.test(url.hostname)) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

function candidates(data) {
  const rows = data.organic ?? data.organic_results ?? [];
  return (Array.isArray(rows) ? rows : []).flatMap(row => [row, ...(Array.isArray(row.extensions) ? row.extensions : []).filter(extension => extension?.link).map(extension => ({ ...extension, title: extension.title ?? extension.text }))])
    .map(row => ({ link: merchantUrl(row.link ?? row.url), title: String(row.title ?? ""), snippet: String(row.description ?? row.snippet ?? ""), source: row.source, image: row.image ?? row.thumbnail, price: row.price ?? (Array.isArray(row.rich_snippet?.top?.extensions) ? row.rich_snippet.top.extensions.find(value => /[$₪€£]/.test(String(value))) : undefined) }))
    .filter(row => row.link);
}

function indexedProduct(row, query, relevant, isCatalog) {
    const link = merchantUrl(row.link ?? row.url ?? row.product_url);
    const title = String(row.title ?? "").trim();
    const imageUrl = productImageUrl(row.image ?? row.thumbnail);
    const priceText = String(row.price ?? "");
    const currency = /₪|\bILS\b|\bNIS\b/i.test(priceText) ? "ILS" : /\$|\bUSD\b/i.test(priceText) ? "USD" : /€|\bEUR\b/i.test(priceText) ? "EUR" : /£|\bGBP\b/i.test(priceText) ? "GBP" : "";
    const amounts = priceText.match(/\d[\d,.]*/g) ?? [];
    const price = row.extracted_price != null ? Number(row.extracted_price) : amounts.length === 1 ? Number(amounts[0].replace(/,/g, "")) : NaN;
    if (!link || !title || !relevant(title, query) || isSearchResultsUrl(link) || isCatalog(title, link) || !imageUrl || !currency || !Number.isFinite(price) || price <= 0 || /out of stock|sold out|unavailable/i.test(`${row.availability ?? ""} ${row.delivery ?? ""}`)) return null;
    return { link, title, id: createHash("sha256").update(link).digest("hex").slice(0, 16), page: { isProduct: true, destinationUrl: link, title, imageUrl, price, currency, availability: String(row.availability ?? ""), specificationText: `${title} ${row.description ?? row.snippet ?? ""}`, priceSource: "indexed", locations: [] } };
}

function indexedShoppingProducts(data, query, relevant, isCatalog) {
  const rows = [data.shopping, data.top_pla, data.bottom_pla].flatMap(value => Array.isArray(value) ? value : []);
  return rows.map(indexed => indexedProduct(indexed, query, relevant, isCatalog)).filter(Boolean);
}

async function bounded(operation, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw deadlineError();
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(deadlineError()), remaining); })]); }
  finally { clearTimeout(timer); }
}

function errorCode(error) { return /Timeout|Abort/.test(error?.name) ? "search_timeout" : typeof error?.code === "string" ? error.code : "search_unavailable"; }

export async function discoverRetailProducts({ query, country, localizedQuery = query, retailQuery, nearbyQuery, config, relevant, isCatalog, deadline = searchContext()?.deadline ?? Date.now() + 16000 }, dependencies = {}) {
  const search = dependencies.search ?? brightDataSearch;
  const readPage = dependencies.readPage ?? ((url, allowPaid) => readMerchantProduct(url, allowPaid ? config : { ...config, productZone: undefined }, deadline - 300));
  const readCatalog = dependencies.readCatalog ?? catalogProductLinks;
  const backup = dependencies.backup ?? backupSearch;
  const directStores = dependencies.directStores ?? (config?.directRetailers && country === "IL" ? searchRetailerSites : async () => ({ products: [], sourceStatus: [] }));
  const openSearch = dependencies.openSearch ?? (config?.directRetailers ? duckduckgoProducts : null);
  const products = new Map(), seen = new Set(), sourceStatus = [], diagnostics = { candidates: 0, rejected: 0, verified: 0 };
  // Reserve merchant reading time. A slow engine cannot discard products from the other.
  const discoveryDeadline = Math.min(deadline - 3500, Date.now() + 9500);
  const productDeadline = deadline - 300;
  const inspect = async (item, followCatalog = true) => {
    if (seen.has(item.link) || Date.now() >= productDeadline) return;
    seen.add(item.link); diagnostics.candidates++;
    try {
      const allowPaid = relevant(item.title, query) && new URL(item.link).pathname !== "/" && !isCatalog(item.title, item.link);
      const page = await bounded(() => readPage(item.link, allowPaid), productDeadline);
      if (page.unavailable || page.availability === "Out of stock") { diagnostics.rejected++; return; }
      if (page.isProduct && !page.isCatalog && !isCatalog(page.title || item.title, item.link) && relevant(page.title || item.title, query) && Number.isFinite(page.price) && page.price > 0 && page.imageUrl) {
        const link = merchantUrl(page.destinationUrl || item.link);
        if (!link || isCatalog(page.title || item.title, link)) { diagnostics.rejected++; return; }
        products.set(link, { ...item, link, page, id: createHash("sha256").update(link).digest("hex").slice(0, 16) });
        diagnostics.verified = products.size;
        return;
      }
      if (!page.isProduct && !page.isCatalog && !page.unavailable) {
        const indexed = indexedProduct(item, query, relevant, isCatalog);
        if (indexed) { products.set(indexed.link, indexed); diagnostics.verified = products.size; return; }
      }
      // Catalogs can discover products but their own prices/images are never offers.
      if (followCatalog && (page.isCatalog || isCatalog(item.title, item.link)) && Date.now() + 2200 < productDeadline) {
        const links = await bounded(() => readCatalog(item.link, title => relevant(title, query)), productDeadline);
        await Promise.allSettled(links.slice(0, 4).map(child => inspect({ ...child, link: merchantUrl(child.link) }, false)));
      } else diagnostics.rejected++;
    } catch { diagnostics.rejected++; }
  };
  const consume = async data => {
    const byHost = new Map();
    const list = candidates(data).map(item => {
      const host = new URL(item.link).hostname, position = byHost.get(host) ?? 0;
      byHost.set(host, position + 1);
      return { item, position };
    }).sort((a, b) => a.position - b.position).slice(0, 20);
    await Promise.allSettled(list.map(({ item }) => inspect(item)));
  };
  const jobs = [
    Promise.resolve().then(() => directStores({ query, localizedQuery, relevant, isCatalog, deadline: productDeadline })).then(direct => {
      sourceStatus.push(...direct.sourceStatus);
      for (const item of direct.products) if (!products.has(item.link)) products.set(item.link, item);
      diagnostics.verified = products.size;
    }).catch(() => sourceStatus.push({ source: "Direct retailer catalogs", status: "failed", code: "retailer_unavailable" })),
  ];
  if (openSearch) jobs.push(Promise.resolve().then(async () => {
    const status = { source: "DuckDuckGo", status: "pending", candidates: 0 };
    sourceStatus.push(status);
    try {
      const data = await bounded(() => openSearch(localizedQuery, country, discoveryDeadline), discoveryDeadline);
      status.candidates = candidates(data).length;
      await consume(data);
      status.status = "completed";
    } catch (error) { status.status = "failed"; status.code = errorCode(error); }
  }));
  // Give fast, free merchant catalogs and open search the first chance. The
  // paid search provider is a fallback when they cannot supply a useful cohort.
  if (config?.directRetailers) await bounded(() => Promise.allSettled(jobs), Math.min(discoveryDeadline, Date.now() + 6500)).catch(() => {});
  const merchantCount = new Set([...products.values()].map(item => new URL(item.link).hostname)).size;
  const providerJobs = (!dependencies.search && (!config?.apiKey || !config?.zone)) || (products.size >= 6 && merchantCount >= 2) ? [] : [
    { engine: "google", query: localizedQuery, country, language: country === "IL" && /[\u0590-\u05ff]/.test(localizedQuery) ? "he" : "en", light: true },
    { engine: "bing", query, country, language: "en" },
    ...(retailQuery ? [{ engine: "google", query: retailQuery, country, language: country === "IL" ? "he" : "en", light: true }] : []),
    { engine: "google", query: nearbyQuery || localizedQuery, country, language: country === "IL" ? "he" : "en", kind: "shopping" },
  ].map(async request => {
    const status = { source: request.kind || request.engine, status: "pending", candidates: 0 };
    sourceStatus.push(status);
    try {
      const data = await bounded(() => search({ ...request, kind: request.kind || "web", noRetry: true }, config, Math.max(1, discoveryDeadline - Date.now())), discoveryDeadline);
      if (request.kind === "shopping") {
        const indexed = indexedShoppingProducts(data, query, relevant, isCatalog);
        status.status = "completed"; status.candidates = indexed.length;
        for (const item of indexed) if (!products.has(item.link)) products.set(item.link, item);
      } else {
        status.status = "completed"; status.candidates = candidates(data).length;
        await consume(data);
      }
    } catch (error) { status.status = "failed"; status.code = errorCode(error); }
  });
  jobs.push(...providerJobs);
  await Promise.allSettled(jobs);
  // A single quota-aware backup is useful for an empty response too, not just HTTP failures.
  if (!products.size && config?.fallbackApiKey && Date.now() + 3500 < productDeadline) {
    const status = { source: "serpapi", status: "pending", candidates: 0 };
    sourceStatus.push(status);
    try {
      const params = new URLSearchParams({ engine: "google", q: query, hl: "en" });
      if (country) params.set("gl", country.toLowerCase());
      const data = await bounded(() => backup(params, config.fallbackApiKey, new Error("Product discovery unavailable")), productDeadline - 2000);
      status.status = "completed"; status.candidates = candidates(data).length;
      await consume(data);
    } catch (error) { status.status = "failed"; status.code = errorCode(error); }
  }
  return { products: [...products.values()], sourceStatus, diagnostics };
}
