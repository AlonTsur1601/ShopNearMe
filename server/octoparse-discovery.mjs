import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { startOctoparseTask, readOctoparseTask, findOctoparseTask } from "./octoparse.mjs";
import { enrichProductPage, isSearchResultsUrl } from "./product-page.mjs";
import { catalogProductLinks } from "./catalog-products.mjs";

const jobs = new Map();
const completed = new Map();
const inFlight = new Map();
const ttl = 15 * 60 * 1000;
const digest = value => createHash("sha256").update(value).digest("hex");

export function signContinuation(task, queryKey, apiKey) {
  const payload = Buffer.from(JSON.stringify({ task, queryKey, expires: Date.now() + 3600000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", apiKey).update(payload).digest("base64url")}`;
}
export function readContinuation(token, queryKey, apiKey) {
  try {
    const [payload, signature] = token.split(".");
    const expected = createHmac("sha256", apiKey).update(payload).digest();
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (value.queryKey !== queryKey || value.expires < Date.now()) throw new Error();
    return value.task;
  } catch { throw Object.assign(new Error("Search continuation expired. Start the search again."), { code: "invalid_continuation" }); }
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|srsltid|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function octoparseProducts(rows, relevant, query) {
  const products = new Map();
  for (const row of rows) {
    const link = httpUrl(row.Product_URL_clean || row.Product_URL);
    const title = String(row.Product_name || "").trim();
    const imageUrl = httpUrl(row.Image_link);
    const rawPrice = String(row.Current_price || "");
    // This adapter's template is explicitly Amazon US; never guess a currency.
    const price = /^\$\s*[\d,]+(?:\.\d{1,2})?$/.test(rawPrice) ? Number(rawPrice.replace(/[$,\s]/g, "")) : NaN;
    if (!link || !/^https:\/\/(?:www\.)?amazon\.com\/dp\/[A-Z0-9]{10}(?:[/?]|$)/i.test(link) || isSearchResultsUrl(link)
      || !title || !relevant(title, query) || !imageUrl || !Number.isFinite(price) || price <= 0
      || /out of stock|unavailable|invalid/i.test(`${row.In_stock || ""} ${row.Product_status || ""}`)) continue;
    products.set(link, { link, title, id: digest(link).slice(0, 16), page: {
      isProduct: true, destinationUrl: link, title, price, currency: "USD", imageUrl,
      specificationText: title, availability: /in stock/i.test(row.In_stock || "") ? "In stock" : "",
      // Delivery estimates are for the template's US destination, not the user.
      locations: [],
    } });
  }
  return [...products.values()];
}

export async function readRetailRows(rows, relevant, query, readPage = enrichProductPage, readCatalog = catalogProductLinks) {
  const links = [...new Set(rows.map(row => httpUrl(row.Detail_URL)).filter(link => link && !isSearchResultsUrl(link)
    && !/(^|\.)(?:google\.[a-z.]+|ebay\.[a-z.]+|amazon\.[a-z.]+|facebook\.com|easy\.co\.il|zap\.co\.il)$/.test(new URL(link).hostname)))].slice(0, 10);
  const inspect = async (link, followCatalog = true) => {
    const page = await readPage(link);
    if (!page.isProduct && !page.unavailable && followCatalog) {
      const children = await readCatalog(link, title => relevant(title, query));
      return (await Promise.allSettled(children.slice(0, 4).map(child => inspect(child.link, false)))).flatMap(result => result.status === "fulfilled" ? result.value : []);
    }
    const destination = httpUrl(page.destinationUrl || link);
    if (!destination || isSearchResultsUrl(destination) || !page.isProduct || page.isCatalog || page.unavailable || page.availability === "Out of stock"
      || !relevant(page.title || "", query) || !Number.isFinite(page.price) || page.price <= 0 || !page.imageUrl || !page.currency) return [];
    return [{ link: destination, title: page.title, id: digest(destination).slice(0, 16), page }];
  };
  // Bound concurrent merchant reads; a burst across catalogs and their children
  // was exhausting per-page deadlines before otherwise valid pages arrived.
  const products = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, links.length) }, async () => {
    while (next < links.length) {
      const link = links[next++];
      try { products.push(...await inspect(link)); } catch { /* Isolate individual merchants. */ }
    }
  }));
  return [...new Map(products.map(product => [product.link, product])).values()];
}

export function octoparsePlaces(rows) {
  return rows.flatMap(row => {
    const latitude = Number(row.Latitude), longitude = Number(row.Longitude);
    const website = httpUrl(row.Website);
    if (!row.Title || !website || !row.Latitude || !row.Longitude
      || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || /permanently closed/i.test(row.Current_Status || "")) return [];
    return [{ title: row.Title, website, address: row.Address || "", type: row.Category || "store", gps_coordinates: { latitude, longitude }, place_id: row.Place_id || digest(website + latitude + longitude) }];
  });
}

export async function discoverOctoparseProducts({ query, country, retailQuery, nearbyQuery, config, relevant }, dependencies = {}) {
  const apiKey = config.octoparseApiKey;
  if (!apiKey) throw Object.assign(new Error("Octoparse is not configured"), { code: "provider_not_configured" });
  const queryKey = digest(`octoparse-v3|${country || ""}|${query.trim().toLowerCase()}|${nearbyQuery || ""}`);
  const cacheKey = `${digest(apiKey)}|${queryKey}`;
  const cached = completed.get(cacheKey);
  if (cached?.expires > Date.now()) return cached.value;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const operation = (async () => {
    const saved = config.continuation ? readContinuation(config.continuation, queryKey, apiKey) : jobs.get(cacheKey) || {};
    const requests = [{ source: "Amazon via Octoparse", key: "amazon", template: "amazon-search-scraper", parameters: { search_Term: [query], marketplaces: "US", number_of_product_per_search: "20", stepLength: "1" } },
      ...(retailQuery ? [{ source: "Retailers via Octoparse", key: "retail", template: "google-search-scraper", parameters: { all_these_words: [retailQuery], pagination_times: "1" } }] : []),
      ...(nearbyQuery ? [{ source: "Nearby branches via Octoparse", key: "places", template: "google-maps-scraper-store-details-by-keyword", parameters: { search_Keywords: [nearbyQuery], number_of_Pages_to_Scrape: "1" } }] : [])];
    const states = {}, sourceStatus = [], products = [], places = [];
    let candidates = 0;
    await Promise.allSettled(requests.map(async request => {
      try {
        let task = saved[request.key];
        const local = jobs.get(cacheKey)?.[request.key];
        if (task && local?.taskId === task.taskId && local?.lotNo === task.lotNo && local.status !== "pending") task = local;
        if (!task || task.expires < Date.now()) {
          const taskName = `ShopNearMe ${queryKey.slice(0, 20)} ${request.key} ${Math.floor(Date.now() / ttl)}`;
          const existing = await (dependencies.find ?? findOctoparseTask)(taskName, apiKey);
          task = { ...(existing || await (dependencies.start ?? startOctoparseTask)(request.template, request.parameters, taskName, apiKey, 20)), expires: Date.now() + 3600000 };
        }
        states[request.key] = task;
        // Keep already exported data in the server cache; the signed client
        // continuation carries task identity only, never an entire export.
        const state = task.rows && task.status !== "pending" ? task : await (dependencies.read ?? readOctoparseTask)(task, apiKey);
        states[request.key] = { ...task, ...state };
        candidates += state.rows.length;
        const found = request.key === "places" ? octoparsePlaces(state.rows) : request.key === "amazon" ? octoparseProducts(state.rows, relevant, query) : await readRetailRows(state.rows, relevant, query, dependencies.readPage);
        if (request.key === "places") places.push(...found); else products.push(...found);
        sourceStatus.push({ source: request.source, status: state.status === "pending" ? "pending" : found.length ? "completed" : "failed", ...(state.status === "pending" || found.length ? {} : { code: "source_empty" }) });
      } catch (error) {
        const task = states[request.key];
        const transient = /Timeout|Abort/.test(error.name) || error.code === "search_timeout";
        if (task && transient && (task.attempts || 0) < 3) {
          states[request.key] = { ...task, status: "pending", attempts: (task.attempts || 0) + 1, nextPollAt: Date.now() + 60000 };
          sourceStatus.push({ source: request.source, status: "pending" });
        } else sourceStatus.push({ source: request.source, status: "failed", code: typeof error.code === "string" ? error.code : "search_unavailable" });
      }
    }));
    jobs.set(cacheKey, states);
    const pending = sourceStatus.some(source => source.status === "pending");
    const nextPollAt = Math.min(...Object.values(states).filter(state => state.status === "pending").map(state => state.nextPollAt));
    const value = {
      products, places, sourceStatus,
      diagnostics: { candidates, verified: products.length, rejected: candidates - products.length },
      ...(pending ? { continuation: signContinuation(Object.fromEntries(Object.entries(states).map(([key, state]) => [key, { ...state, rows: undefined }])), queryKey, apiKey), nextPollAt } : {}),
    };
    // Reuse terminal empty results too: refreshing must not launch unbounded jobs.
    completed.set(cacheKey, { expires: pending ? nextPollAt : Date.now() + ttl, value });
    return value;
  })().finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, operation);
  return operation;
}
