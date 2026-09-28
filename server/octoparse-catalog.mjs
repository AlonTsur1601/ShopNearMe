import { createHash } from "node:crypto";
import { load } from "cheerio";
import { extractProductData, isSearchResultsUrl } from "./product-page.mjs";
import { reuseOctoparseTask, readPoolTask } from "./octoparse-pool.mjs";
import { octoparseProducts, octoparsePlaces, signContinuation, readContinuation } from "./octoparse-discovery.mjs";
import { sameProductIdentity } from "./product-identity.mjs";
import { extractMarkdownSpecifications, productMarkdownText, specificationPairs } from "./specifications.mjs";
import { searchContext } from "./search-budget.mjs";

const cache = new Map();
const jobs = new Map();
const active = new Map();
const digest = value => createHash("sha256").update(value).digest("hex");
function url(value, base) {
  if (typeof value !== "string" || !value.trim() || /^(?:undefined|null)$/i.test(value.trim())) return "";
  try {
    const link = new URL(value, base);
    link.hash = "";
    for (const key of [...link.searchParams.keys()]) if (/^(?:utm_.+|srsltid|gclid|fbclid)$/i.test(key)) link.searchParams.delete(key);
    // Search-result tracking changes between exports and the product page.
    // Preserve variant selectors (var) and every other semantic parameter.
    if (/^(?:www\.)?ebay\.[a-z.]+$/i.test(link.hostname) && /^\/itm\//i.test(link.pathname)) {
      for (const key of ["_skw", "itmmeta", "itmprp", "hash"]) link.searchParams.delete(key);
    }
    return /^https?:$/.test(link.protocol) && !link.username && !link.password ? link.href : "";
  } catch { return ""; }
}
// Round-robin merchants before applying a request budget. A large first catalog
// must not consume every detail/branch slot and hide the other stores.
export function merchantBalancedLinks(links, limit, perMerchant = Infinity) {
  const groups = new Map();
  for (const value of links) {
    const link = url(value); if (!link) continue;
    const host = new URL(link).hostname.replace(/^www\./, "");
    const group = groups.get(host) ?? [];
    if (!group.includes(link) && group.length < perMerchant) group.push(link);
    groups.set(host, group);
  }
  const result = [];
  for (let index = 0; result.length < limit; index++) {
    const next = [...groups.values()].flatMap(group => group[index] ? [group[index]] : []);
    if (!next.length) break;
    result.push(...next.slice(0, limit - result.length));
  }
  return result;
}
function priced(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/(?:USD|\$|ILS|₪|EUR|€|GBP|£)\s*([\d.,]+)|([\d.,]+)\s*(?:USD|\$|ILS|₪|EUR|€|GBP|£)/i);
  const amount = match?.[1] || match?.[2] || "";
  const decimal = amount.match(/[.,](\d{2})$/);
  const price = amount ? Number(decimal ? amount.slice(0, decimal.index).replace(/[.,]/g, "") + "." + decimal[1] : amount.replaceAll(",", "")) : NaN;
  const currency = /ILS|₪/.test(text) ? "ILS" : /USD|\$/.test(text) ? "USD" : /EUR|€/.test(text) ? "EUR" : /GBP|£/.test(text) ? "GBP" : "";
  return { price, currency };
}
function record(page, link) {
  return { id: digest(link).slice(0, 16), title: page.title, link, page: { ...page, destinationUrl: link } };
}
function htmlSnapshot(result) {
  return { ...result, locations: [...result.locations], observations: [...result.observations] };
}
function restoreHtmlSnapshot(snapshot) {
  return { ...snapshot, locations: new Map(snapshot.locations), observations: new Map(snapshot.observations) };
}
function mergeLocations(...groups) {
  return [...new Map(groups.flat().map(place => [JSON.stringify([place.address, place.name, place.lat, place.lon]), place])).values()];
}
function appendHtmlSnapshot(previous, next) {
  if (!previous) return htmlSnapshot(next);
  const before = restoreHtmlSnapshot(previous);
  return htmlSnapshot({
    products: [...new Map([...before.products, ...next.products].map(product => [product.link, product])).values()],
    candidates: [...new Set([...before.candidates, ...next.candidates])],
    branchUrls: [...new Set([...before.branchUrls, ...next.branchUrls])],
    blocked: [...new Set([...before.blocked, ...next.blocked])],
    observations: new Map([...before.observations, ...next.observations]),
    locations: new Map([...new Set([...before.locations.keys(), ...next.locations.keys()])].map(host => [host, mergeLocations(before.locations.get(host) ?? [], next.locations.get(host) ?? [])])),
  });
}
function validProduct(page, link, relevant, query) {
  return link && !isSearchResultsUrl(link) && !/(^|\.)google\.[a-z.]+$/i.test(new URL(link).hostname)
    && !/\/(?:product[-_]cat(?:egory)?|product-tag|blogs?|articles?|guides?|news)(?:\/|$)/i.test(new URL(link).pathname)
    && (!/\/collections?(?:\/|$)/i.test(new URL(link).pathname) || /\/products?\//i.test(new URL(link).pathname))
    && page.isProduct && !page.isCatalog && page.availability !== "Out of stock"
    && relevant(`${page.title || ""} ${page.categoryText || ""}`, query)
    && Number.isFinite(page.price) && page.price > 0 && page.currency && url(page.imageUrl);
}

export function octoparseMarketplaceRows(rows, relevant, query) {
  return rows.flatMap(row => {
    const link = url(row.Product_URL || row.ProductUrl), title = String(row.Title || row.ProductName || "").trim();
    const imageUrl = url(row.Image_URL || row.ImageURL), condition = String(row.Condition || row.Sub_title || "").trim();
    const { price, currency } = priced(row.Pricing || row.Price);
    if (!link || !/^https:\/\/(?:www\.)?ebay\.[a-z.]+\/itm\//i.test(link) || !imageUrl || !title || !relevant(title, query) || !Number.isFinite(price) || price <= 0 || !currency) return [];
    return [record({ isProduct: true, title, imageUrl, price, currency, condition, specificationText: `${title} ${row.Sub_title || ""}`, localEligible: false }, link)];
  });
}

// Parse only HTML returned by Octoparse. This module never fetches a retailer,
// calls another search provider, or substitutes directory entries for products.
export function productsFromOctoparseHtml(rows, relevant, query) {
  const products = new Map(), candidates = new Map(), branchUrls = new Set(), locations = new Map(), observations = new Map(), blocked = [];
  for (const row of rows) {
    const link = url(row.Original_URL), html = String(row.Source_code || "");
    if (!link || !html) continue;
    const $ = load(html);
    const visible = $("body").clone(); visible.find("script,style,nav,footer").remove();
    const challenge = /verify (?:you are|that you are) human|access denied|checking your browser|sorry, you have been blocked|הגישה נחסמה/i.test(visible.text()) || /^(?:just a moment|attention required.*cloudflare|access denied|error page\b)/i.test($("title").text().trim()) || $("#challenge-running, #captcha-form, form[action*='/sorry/']").length > 0;
    if (challenge && !/application\/ld\+json/i.test(html)) { blocked.push(link); continue; }
    const page = extractProductData(html, link);
    const grid = $(".products, .product-grid, .collection, .products-grid, .product-list");
    const cards = grid.find(".product-item, .product, .grid__item, .product-card");
    if (cards.length > 1 && !$(".product-info-main, #productMainBlock, #dp-container, .single-product, .product-detail").find("h1").length) page.isCatalog = true;
    observations.set(link, page);
    // Retailer branch pages often publish addresses rather than coordinates.
    // Keep their own address and branch heading for the location geocoder.
    for (const element of $("address,[itemprop='address'],.store-address,.branch-address,[class$='-address'],[class$='_address']").toArray()) {
      const address = $(element).text().replace(/\s+/g, " ").trim();
      if (!address || address.length > 250) continue;
      const card = $(element).closest(".store-item,article,li,[itemscope],[class$='-card'],[class*='branch'][class*='item']");
      const name = card.find("h2,h3,h4").first().text().replace(/\s+/g, " ").trim();
      const host = new URL(link).hostname, found = locations.get(host) ?? [];
      if (!found.some(place => place.address === address)) found.push({ address, name });
      locations.set(host, found);
    }
    if (validProduct(page, link, relevant, query)) products.set(link, record(page, link));
    for (const script of $('script[type="application/ld+json"]').toArray()) {
      let data; try { data = JSON.parse($(script).text()); } catch { continue; }
      if ([data].flat().flatMap(item => item?.["@graph"] ?? [item]).some(item => [item?.["@type"]].flat().includes("CollectionPage"))) { page.isCatalog = true; products.delete(link); }
      for (const list of [data].flat().flatMap(item => item?.["@graph"] ?? [item])) for (const entry of list?.itemListElement ?? []) {
        const item = entry.item;
        if (!item || typeof item !== "object" || !item.offers) continue;
        const itemLink = url(item.url, link);
        const itemPage = extractProductData(`<script type="application/ld+json">${JSON.stringify(item)}</script>`, itemLink || link);
        if (validProduct(itemPage, itemLink, relevant, query)) products.set(itemLink, record(itemPage, itemLink));
      }
    }
    // A price belongs to its product card, never to the entire search page.
    for (const element of $(".product-item, .products .product, .product-grid .product, .grid__item, .product-card, .card--product, .product_box, .ty-grid-list__item, [data-component-type='s-search-result'], .s-item, [itemtype$='/Product']").toArray()) {
      const card = $(element);
      card.find("del,s,.old-price,.a-text-price,.price--compare,.price__was,.ty-list-price").remove();
      const anchor = card.is("a[href]") ? card : card.find("a.product-item-link, .product-item-name a, a.s-item__link, a[href*='/dp/'], a[itemprop='url'], a.woocommerce-LoopProduct-link, .product__title a, a[href*='/products/']").first().length ? card.find("a.product-item-link, .product-item-name a, a.s-item__link, a[href*='/dp/'], a[itemprop='url'], a.woocommerce-LoopProduct-link, .product__title a, a[href*='/products/']").first() : card.find("a[href]").first();
      const itemLink = url(anchor.attr("href"), link);
      if (!itemLink) continue;
      const title = card.find(".product-item-name, .s-item__title, h2, h3, .product-name, .product-title, .card__title, .ty-grid-list__item-name, [itemprop='name']").first().text().trim() || anchor.attr("title") || anchor.attr("aria-label") || card.find("img").attr("alt");
      const priceNode = card.find("[data-price-type='finalPrice'], .a-price:not(.a-text-price) .a-offscreen, .s-item__price, [itemprop='price'], .woocommerce-Price-amount, .price__regular .price-item--regular, .price .money, .price__current, .price, .ty-price").first();
      const amount = priceNode.attr("data-price-amount") || priceNode.attr("content");
      const priceDisplay = priceNode.clone();
      priceDisplay.find("sup").each((_, fraction) => { const digits = priceDisplay.find(fraction).text().trim(); if (/^\d{2}(?:\s*(?:₪|\$|€|£|ILS|USD|EUR|GBP))?$/.test(digits)) priceDisplay.find(fraction).replaceWith("." + digits); });
      const display = priceDisplay.text().trim();
      const parsed = priced(display);
      const explicitCurrency = card.find("[itemprop='priceCurrency']").attr("content");
      const symbol = card.find(".ty-price-cur, .woocommerce-Price-currencySymbol, .currency-symbol").first().text().trim();
      const currency = explicitCurrency || parsed.currency || priced(symbol + " 1").currency || (new URL(link).hostname === "www.ace.co.il" && priceNode.attr("data-price-type") ? "ILS" : "");
      const price = amount && /^\d+(?:\.\d{1,2})?$/.test(amount) ? Number(amount) : Number.isFinite(parsed.price) ? parsed.price : currency ? priced(currency + " " + display).price : NaN;
      const image = card.find("img").first();
      const imageUrl = url(image.attr("data-src") || image.attr("data-lazy-src") || image.attr("src") || image.attr("srcset")?.split(",")[0].trim().split(/\s/)[0], link);
      const condition = card.find(".SECONDARY_INFO, .s-item__subtitle").first().text().trim();
      let metadata; try { metadata = JSON.parse(card.closest("[data-params]").attr("data-params") || "{}"); } catch { metadata = {}; }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) metadata = {};
      if (metadata.name && !sameProductIdentity(title, metadata.name)) metadata = {};
      const specifications = specificationPairs(metadata).filter(pair => !/^(?:id(?:_pr)?|name|price|category|subCategory|variant|list|position)$/i.test(pair.name));
      // The merchant's own selected-product slug and image alt often retain
      // variant facts omitted from a short display title. Exclude ancestors,
      // query strings and neighboring cards from this evidence.
      let slug = new URL(itemLink).pathname.split("/").filter(Boolean).at(-1) ?? "";
      try { slug = decodeURIComponent(slug); } catch { /* Keep a malformed source escape isolated to its slug. */ }
      slug = slug.replace(/[-_]/g, " ");
      const item = { isProduct: true, title, price, currency, imageUrl, condition, brand: metadata.brand, specifications,
        specificationText: [title, image.attr("alt"), slug].filter(Boolean).join(" "), priceSource: "catalog", localEligible: !card.find(".external_seller").length };
      if (validProduct(item, itemLink, relevant, query) && !/out of stock|sold out|אזל המלאי/i.test(card.find(".stock, .availability").text())) products.set(itemLink, record(item, itemLink));
    }
    for (const anchor of $("a[href]").toArray()) {
      const node = $(anchor), href = url(node.attr("href"), link);
      if (!href) continue;
      const text = [node.text(),node.attr("title"),node.find("img").attr("alt")].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
      let branchPath = new URL(href).pathname;
      try { branchPath = decodeURIComponent(branchPath); } catch { /* One malformed navigation escape cannot discard the merchant's products. */ }
      if (new URL(href).origin === new URL(link).origin && (/(?:^|[\s/_-])(?:stores?|branches|branchs|סניפים|סניף)(?:$|[\s/_-])/i.test(branchPath) || /^(?:our stores|store locator|find a store|branches|הסניפים שלנו|סניפים|איתור סניף)$/i.test(text)) && !/cart|account|privacy/.test(href)) branchUrls.add(href);
      if (/waze\.com|maps\.google|google\.com\/maps/.test(href)) {
        const map = new URL(href), target = map.searchParams.get("ll") || map.searchParams.get("query") || map.searchParams.get("q") || "";
        const coordinates = /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(target) ? target.split(",").map(Number) : [];
        const card = node.closest(".store-item, article, li, [itemscope], .branch, .store, [class$='-card'], [class$='_card']");
        const address = card.find("[itemprop=address], .address, [class$='-address'], [class$='_address']").first().text().trim() || card.children("p").first().text().trim();
        const places = locations.get(new URL(link).hostname) ?? [];
        if (coordinates.length === 2 && coordinates.every(Number.isFinite) && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180) {
          if (!places.some(place => place.lat === coordinates[0] && place.lon === coordinates[1])) places.push({ lat: coordinates[0], lon: coordinates[1], address, name: card.find("h2,h3").first().text().trim() });
        } else if (target.trim() && target.length <= 250 && !/^place_id:/.test(target)) {
          const branchAddress = address || target.trim();
          if (!places.some(place => place.address === branchAddress)) places.push({ address: branchAddress, name: card.find("h2,h3").first().text().trim() });
        }
        if (places.length) locations.set(new URL(link).hostname, places);
      }
      if (href === link || new URL(href).pathname === "/" || isSearchResultsUrl(href) || !relevant(text, query)) continue;
      if (/\.(?:jpg|png|webp|gif|svg|pdf)(?:$|\?)/i.test(href)) continue;
      if (/google\.[a-z.]+$/.test(new URL(href).hostname) || /\/(?:cart|checkout|account|category)(?:\/|$)/i.test(href)) continue;
      const score = Number(node.find("img").length > 0) + 3 * Number(node.closest(".product-item,.product-card,.product_box,.grid__item,.ty-grid-list__item,.products .product").length > 0) + Number(/\/(?:products?|p|dp)\//i.test(new URL(href).pathname));
      candidates.set(href, Math.max(candidates.get(href) ?? 0, score));
    }
  }
  for (const product of products.values()) if (locations.has(new URL(product.link).hostname)) product.page.locations = locations.get(new URL(product.link).hostname);
  return { products: [...products.values()], candidates: [...candidates].sort((a,b) => b[1]-a[1]).map(([link]) => link), branchUrls: [...branchUrls], locations, observations, blocked };
}

export function recoverOctoparseSpecifications(products, pages) {
  return products.flatMap(product => {
    const direct = pages.observations.get(product.link);
    if (direct?.availability === "Out of stock") return [];
    const matching = [...pages.observations.entries()].filter(([link, page]) => page.isProduct && !page.isCatalog && (
      link === product.link && sameProductIdentity(product.title, page.title)
      || product.page.gtin && page.gtin === product.page.gtin
      || product.page.mpn && product.page.brand && String(page.mpn).toLowerCase() === String(product.page.mpn).toLowerCase() && String(page.brand).toLowerCase() === String(product.page.brand).toLowerCase()
      || sameProductIdentity(product.title, page.title)
    )).map(([,page]) => page);
    if (!matching.length) return [product];
    return [{ ...product, page: { ...product.page,
      specifications: [...(product.page.specifications ?? []), ...matching.flatMap(page => page.specifications ?? [])],
      specificationText: [product.page.specificationText, ...matching.map(page => page.specificationText)].filter(Boolean).join("\n"),
      brand: product.page.brand || matching.find(page => page.brand)?.brand,
      condition: product.page.condition || matching.find(page => page.condition)?.condition,
    } }];
  });
}

export function recoverOctoparseContent(products, rows) {
  return products.map(product => {
    const matching = rows.filter(row => !row.error_message && url(row.url) === url(product.link) && sameProductIdentity(product.title, row.title));
    const content = matching.flatMap(row => {
      if (row.format === "json") { try { return [JSON.parse(row.content).text || ""]; } catch { return []; } }
      return [String(row.content || "")];
    }).map(productMarkdownText).join("\n");
    return content ? { ...product, page: { ...product.page,
      specifications: [...(product.page.specifications ?? []), ...extractMarkdownSpecifications(content)],
      specificationText: [product.page.specificationText, content].filter(Boolean).join("\n"),
    } } : product;
  });
}

export function recoverIndexedSpecifications(products, rows) {
  return products.map(product => {
    // An indexed excerpt from this exact product page remains source evidence
    // when its subsequent HTML fetch is blocked. Never transfer a sibling's
    // facts, or use excerpt prices/images to manufacture a product offer.
    const content = rows.filter(row => url(row.Detail_URL) === url(product.link) && sameProductIdentity(product.title, row.Title))
      .map(row => String(row.Descriptipn || row.Description || "").trim()).filter(Boolean).join("\n");
    return content ? { ...product, page: { ...product.page,
      specifications: [...(product.page.specifications ?? []), ...extractMarkdownSpecifications(content)],
      specificationText: [product.page.specificationText, content].filter(Boolean).join("\n"),
    } } : product;
  });
}

export function persistOctoparseLocations(discovery, apiKey) {
  if (!discovery.continuation || !discovery.queryKey) return discovery.continuation;
  const states = readContinuation(discovery.continuation, discovery.queryKey, apiKey);
  const byHost = {};
  for (const product of discovery.products) {
    const host = new URL(product.link).hostname;
    const located = (product.page.locations ?? []).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon));
    byHost[host] = [...new Map([...(byHost[host] ?? []), ...located].map(place => [JSON.stringify([place.address, place.name]), place])).values()];
  }
  states.branchCoordinates = { byHost };
  return signContinuation(states, discovery.queryKey, apiKey);
}

export async function discoverOctoparseCatalog({ query, country, localizedQuery = query, retailQuery, nearbyQuery, nearbyLocation, config, relevant, isCatalog = () => false, specificationRequests }, dependencies = {}) {
  const apiKey = config.octoparseApiKey;
  if (!apiKey) throw Object.assign(new Error("Octoparse is not configured"), { code: "provider_not_configured" });
  const queryKey = digest(`octoparse-pool-v2|${country}|${query}|${nearbyQuery || ""}`), cacheKey = digest(apiKey) + queryKey;
  const cached = cache.get(cacheKey);
  if (cached?.expires > Date.now()) return cached.value;
  if (active.has(cacheKey)) return active.get(cacheKey);
  const start = dependencies.start ?? reuseOctoparseTask, read = dependencies.read ?? readPoolTask;
  const operation = (async () => {
    const saved = config.continuation ? readContinuation(config.continuation, queryKey, apiKey) : jobs.get(cacheKey) ?? {};
    const states = { ...saved }, sourceStatus = [], rows = {};
    const catalogUrls = country === "IL" ? [
      `https://www.ivory.co.il/catalog.php?act=cat&q=${encodeURIComponent(localizedQuery)}`,
      `https://www.lastprice.co.il/category.asp?q=${encodeURIComponent(localizedQuery)}`,
      `https://www.ace.co.il/catalogsearch/result/?q=${encodeURIComponent(localizedQuery)}`,
      "https://www.ace.co.il/stores",
    ] : [];
    const catalogRequest = { key: "catalogs", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": catalogUrls.length ? catalogUrls : [`https://www.amazon.com/s?k=${encodeURIComponent(query)}`], "Wait Before Extraction (seconds)": "3" } };
    const requests = [
      { key: "retail", role: "retail", template: 15, values: { MainKeys: [...new Set([retailQuery || `${query} price`, country === "IL" ? `${query} price site:.il` : `${query} price`, ...(nearbyQuery ? [nearbyQuery] : [])])], Pagination_times: "1" } },
      { key: "amazon", role: "amazon-classic", template: 1153, values: { Site: "United States", "Confirm your site": ["https://www.amazon.com/"], "Keywords (up to 100,000)": [query], "Number of Pages to Scrape": "1" } },
      { key: "marketplace", role: "marketplace", template: 1063, values: { "123": "United States", "6tutxf6k2ik.List": ["https://www.ebay.com"], "1x7v90yy9yr.List": [query], "j4s3pig01g.ExecutedTimesLimitation": "1" } },
      ...(states.catalogs ? [catalogRequest] : []),
    ];
    async function collect(request) {
      try {
        let state = states[request.key];
        if (state?.status === "failed" && !config.continuation && state.retryAt <= Date.now()) state = undefined;
        if (!state || state.deferred && !(state.nextPollAt > Date.now())) {
          // Parsing/export may use most of this request's deadline. Start the
          // next phase in a fresh request instead of losing an accepted run.
          if (searchContext()?.deadline - Date.now() < 8000) {
            state = { ...state, status: "pending", deferred: true, rows: [], nextPollAt: Date.now() + 1000 };
          } else state = { ...await start(request.role, request.template, request.values, apiKey), ...(request.template === 1395 ? { requestedUrls: request.values["URLs (up to 10,000 per run)"] } : {}) };
        }
        states[request.key] = state;
        const local = jobs.get(cacheKey)?.[request.key];
        if (local && local.lotNo === state.lotNo && local.status !== "pending" && local.rows) state = local;
        state = state.deferred || state.status !== "pending" && (state.snapshot || state.savedRows || state.rows) ? state : state.status === "failed" && !state.taskId ? { ...state, rows: [] } : await read(state, apiKey, request.template === 1395 ? {
          pageSize: 1,
          consume: (chunk, progress) => ({
            snapshot: appendHtmlSnapshot(progress.snapshot, productsFromOctoparseHtml(chunk, relevant, query)),
            returnedUrls: [...new Set([...(progress.returnedUrls ?? []), ...chunk.filter(row => row.Source_code).map(row => url(row.Original_URL))])],
          }),
        } : {});
        if (state.status !== "pending" && state.rows && !state.snapshot && !state.savedRows) {
          if (request.template === 1395) {
            const returned = new Set(state.rows.filter(row => row.Source_code).map(row => url(row.Original_URL)));
            state = { ...state, missingPages: (state.requestedUrls ?? []).filter(link => !returned.has(url(link))), snapshot: htmlSnapshot(productsFromOctoparseHtml(state.rows, relevant, query)), rows: [] };
          }
          else state = { ...state, savedRows: state.rows };
        }
        if (state.status === "failed" && !state.retryAt) state.retryAt = Date.now() + 30000;
        if (request.template === 1395 && state.snapshot && state.status !== "pending") {
          const returned = new Set(state.returnedUrls ?? state.snapshot.observations.map(([link]) => link));
          state.missingPages = (state.requestedUrls ?? []).filter(link => !returned.has(url(link)));
        }
        states[request.key] = state;
        rows[request.key] = state.savedRows ?? state.rows ?? [];
        sourceStatus.push({ source: `${/^branches\d*$/.test(request.key) ? "Nearby branches" : request.key === "pages" ? "Product pages" : request.key} via Octoparse`, status: state.status === "pending" ? "pending" : state.status === "failed" ? "failed" : state.collectedRows || rows[request.key].length || state.snapshot?.observations.length ? "completed" : "empty", ...(state.status === "failed" ? { code: state.code || "search_unavailable" } : {}) });
        if (state.status !== "pending" && state.missingPages?.length) sourceStatus.push({ source: "Product pages via Octoparse", status: "failed", code: "incomplete_retrieval" });
      } catch (error) {
        const existing = states[request.key];
        if (["provider_busy", "provider_rate_limited"].includes(error.code) && (existing?.attempts || 0) < 8) {
          // A shared pool slot being occupied is not a finished failed search.
          // Resume when it is free without creating or stopping another task.
          states[request.key] = { status: "pending", deferred: true, rows: [], attempts: (existing?.attempts || 0) + 1, nextPollAt: Date.now() + 15000 };
          sourceStatus.push({ source: `${request.key} via Octoparse`, status: "pending" });
          return;
        }
        const transient = /Timeout|Abort/.test(error.name) || error.code === "search_timeout" || error.code === "incomplete_export";
        if (transient && (existing?.attempts || 0) < 2) {
          // The start acknowledgement can time out after Octoparse accepts it.
          // Resume through the pool lookup, which reuses a matching running lot.
          states[request.key] = { ...existing, ...(!existing?.taskId ? { deferred: true } : ["completed", "empty", "failed"].includes(existing.status) ? { exportStatus: existing.status } : {}), status: "pending", rows: [], attempts: (existing?.attempts || 0) + 1, nextPollAt: Date.now() + 15000 };
          sourceStatus.push({ source: `${request.key} via Octoparse`, status: "pending" });
        } else {
          states[request.key] = { ...existing, status: "failed", rows: [], code: typeof error.code === "string" ? error.code : transient ? "search_timeout" : "search_unavailable", retryAt: Date.now() + 30000 };
          sourceStatus.push({ source: `${request.key} via Octoparse`, status: "failed", code: states[request.key].code });
        }
      }
    }
    function htmlData(...keys) {
      const result = { products: [], candidates: [], branchUrls: [], blocked: [], locations: new Map(), observations: new Map() };
      for (const key of keys) {
        const part = states[key]?.snapshot ? restoreHtmlSnapshot(states[key].snapshot) : productsFromOctoparseHtml(rows[key] || [], relevant, query);
        for (const field of ["products", "candidates", "branchUrls", "blocked"]) result[field].push(...part[field]);
        for (const [link, observation] of part.observations) result.observations.set(link, observation);
        for (const [host, places] of part.locations) result.locations.set(host, [...(result.locations.get(host) || []), ...places]);
      }
      return result;
    }
    await Promise.all(requests.map(collect));
    // Retailer detail reads can run alongside marketplace collection. Waiting
    // for an unrelated slow marketplace before starting them serialized search.
    if (states.retail?.status !== "pending" && (states.retail?.status === "failed" || !(rows.retail || []).length)) await collect({ key: "retailBing", role: "retail-bing", template: 1471, values: { Country_Area: "United States - English", MainKeys: [retailQuery || `${query} price`], pagination: "1" } });
    const indexedLinks = [...(rows.retail || []), ...(rows.retailBing || [])].map(row => url(row.Detail_URL || row.URL || row.Url || row.Link)).filter(Boolean);
    // Search-discovered merchants take the HTML slot first. Fixed catalog
    // seeds are a fallback, rather than an extra cloud run before every real
    // merchant. Keep reading an already accepted catalog run on continuation.
    if (!states.catalogs && states.retail?.status !== "pending" && states.retailBing?.status !== "pending" && !indexedLinks.length) await collect(catalogRequest);
    const catalogs = htmlData("catalogs");
    const amazonProducts = octoparseProducts(rows.amazon || [], relevant, query), primaryMarketplace = octoparseMarketplaceRows(rows.marketplace || [], relevant, query);
    const marketplaceState = states.marketplace;
    // The same official template can succeed on another supported regional
    // site when the US route is empty/blocked. Reuse the existing pool task;
    // never retry quota, authentication or account-plan failures elsewhere.
    if (states.marketplaceUK || marketplaceState?.status !== "pending" && !primaryMarketplace.length && (marketplaceState?.status !== "failed" || ["search_timeout", "search_unavailable", "source_blocked", "retailer_blocked"].includes(marketplaceState.code))) {
      await collect({ key: "marketplaceUK", role: "marketplace", template: 1063, values: { "123": "United Kingdom", "6tutxf6k2ik.List": ["https://www.ebay.co.uk"], "1x7v90yy9yr.List": [query], "j4s3pig01g.ExecutedTimesLimitation": "1" } });
    }
    const fallbackMarketplace = octoparseMarketplaceRows(rows.marketplaceUK || [], relevant, query);
    const marketplaceProducts = [...primaryMarketplace, ...fallbackMarketplace];
    for (const [key, found] of [["amazon", amazonProducts], ["marketplace", primaryMarketplace], ["marketplaceUK", fallbackMarketplace]]) {
      const status = sourceStatus.find(source => source.source === `${key} via Octoparse`);
      if (status && ["completed", "empty"].includes(status.status)) status.status = found.length ? "completed" : "empty";
    }
    const baseProducts = [...catalogs.products, ...amazonProducts, ...marketplaceProducts];
    if (nearbyQuery && states.retail?.status !== "pending" && states.retailBing?.status !== "pending") {
      // Map discovery can run while HTML is collected. These entries are
      // lookup candidates only; the result layer joins them solely to actual
      // priced, pictured products from the same merchant.
      const hosts = [...new Set([...indexedLinks, ...[...baseProducts, ...htmlData("pages", "children").products].filter(product => product.page.localEligible !== false).map(product => product.link)]
        .map(link => new URL(link).hostname.replace(/^www\./, "")).filter(host => !/(^|\.)(?:amazon\.[a-z.]+|ebay\.[a-z.]+|google\.[a-z.]+)$/.test(host)))];
      const branchKeys = Object.keys(states).filter(key => /^branches\d*$/.test(key)).sort((a,b) => Number(a.slice(8) || 0)-Number(b.slice(8) || 0));
      const searched = new Set();
      let branchesPending = false, branchesQuotaExhausted = false;
      async function collectBranches(key, merchants) {
        await collect({ key, role: "branches", template: 686, values: { MainKeys: merchants.map(merchant => `${merchant} ${nearbyLocation || ""}`), PageSize: "1" } });
        states[key].requestedHosts = merchants;
        merchants.forEach(host => searched.add(host));
        branchesPending ||= states[key].status === "pending";
        branchesQuotaExhausted ||= states[key].code === "quota_exhausted";
      }
      for (const key of branchKeys) await collectBranches(key, states[key].requestedHosts ?? hosts);
      if (!branchesPending && !branchesQuotaExhausted) {
        // A Maps page can contain up to twenty places per merchant query.
        // Keep each immutable lot within the 100-record export bound.
        const remaining = hosts.filter(host => !searched.has(host));
        for (let first = 0, index = branchKeys.length; first < remaining.length; first += 5, index++) {
          await collectBranches(index ? `branches${index}` : "branches", remaining.slice(first, first + 5));
          if (branchesPending || branchesQuotaExhausted) break;
        }
      }
    }
    if (states.catalogs?.status !== "pending" && states.retail?.status !== "pending" && states.retailBing?.status !== "pending") {
      const alreadyPriced = new Set(baseProducts.map(product => product.link));
      const links = merchantBalancedLinks([...indexedLinks, ...catalogs.candidates].filter(link => !alreadyPriced.has(link) && !/\/(?:cart|checkout|account)\b|(^|\.)google\.[a-z.]+\//.test(link)), 30, 5);
      if (links.length) await collect({ key: "pages", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": links, "Wait Before Extraction (seconds)": "3" } });
      const detailPages = htmlData("pages");
      if (states.pages && states.pages.status !== "pending") {
        const merchantHosts = new Set([...baseProducts, ...detailPages.products].filter(product => product.page.localEligible !== false && !/amazon\.|ebay\./.test(product.link)).map(product => new URL(product.link).hostname));
        const branchLinks = nearbyQuery ? merchantBalancedLinks([...catalogs.branchUrls, ...detailPages.branchUrls, ...htmlData("children").branchUrls].filter(link => !links.includes(link) && merchantHosts.has(new URL(link).hostname)), 20, 3) : [];
        if (branchLinks.length) await collect({ key: "branchPages", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": branchLinks, "Wait Before Extraction (seconds)": "3" } });
        // Own branch facts complete the existing product cohort. Give them
        // priority over optional child products sharing the same HTML task.
        if (states.branchPages?.status !== "pending") {
          const children = merchantBalancedLinks(detailPages.candidates.filter(link => !links.includes(link) && !alreadyPriced.has(link) && !detailPages.products.some(product => product.link === link) && !isCatalog("",link)), 24, 4);
          if (children.length) await collect({ key: "children", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": children, "Wait Before Extraction (seconds)": "3" } });
        }
      }
    }
    const pages = htmlData("pages", "children", "branchPages");
    let products = recoverOctoparseSpecifications([...new Map([...baseProducts, ...pages.products].map(product => [product.link, product])).values()], pages);
    products = recoverIndexedSpecifications(products, [...(rows.retail ?? []), ...(rows.retailBing ?? [])]);
    for (const product of products) {
      const found = mergeLocations(product.page.locations ?? [], catalogs.locations.get(new URL(product.link).hostname) ?? [], pages.locations.get(new URL(product.link).hostname) ?? []);
      if (found.length) {
        const located = states.branchCoordinates?.byHost?.[new URL(product.link).hostname] ?? [];
        product.page.locations = found.map(place => located.find(saved => saved.address === place.address && saved.name === place.name) ?? place);
      }
      if (/amazon\.|ebay\./.test(new URL(product.link).hostname)) product.page.localEligible = false;
    }
    // Retry missing properties against source pages for the same product.
    // Completion of discovery alone does not establish complete filter values.
    // Branch coordinates do not change product identity or specifications.
    // Recover the specs alongside Maps instead of adding another cloud wait.
    if (products.length && specificationRequests) {
      const contentKeys = Object.keys(states).filter(key => /^content\d*$/.test(key)).sort((a,b) => Number(a.slice(7) || 0)-Number(b.slice(7) || 0));
      let contentPending = false, contentQuotaExhausted = false;
      const attempted = new Set();
      // The discovery cohort can grow while a slow source is running. Persist
      // each recovery batch by URL, rather than by its position in that cohort.
      for (const key of contentKeys) {
        const targets = states[key].requestedUrls || [];
        if (!targets.length) continue;
        await collect({ key, role: "content", template: 2113, values: { MainKeys: targets, Depth: "0", Total_num: "1", Format: "markdown", Output_Field_Name: "content" } });
        states[key].requestedUrls = targets;
        targets.forEach(link => attempted.add(link));
        products = recoverOctoparseContent(products, rows[key] || []);
        contentPending ||= states[key].status === "pending";
        contentQuotaExhausted ||= states[key].code === "quota_exhausted";
      }
      if (!contentPending && !contentQuotaExhausted && specificationRequests(products).length) {
        const remaining = products.filter(product => !attempted.has(product.link));
        let batchIndex = contentKeys.length;
        // The documented content template accepts URL lists. Use the same
        // 100-record export bound in one run instead of serializing tiny runs.
        for (let first = 0; first < remaining.length; first += 100) {
          const index = batchIndex++, key = index ? `content${index}` : "content";
          const targets = remaining.slice(first, first + 100).map(product => product.link);
          await collect({ key, role: "content", template: 2113, values: { MainKeys: targets, Depth: "0", Total_num: "1", Format: "markdown", Output_Field_Name: "content" } });
          states[key].requestedUrls = targets;
          products = recoverOctoparseContent(products, rows[key] || []);
          if (states[key].status === "pending") { contentPending = true; break; }
          if (states[key].code === "quota_exhausted") { contentQuotaExhausted = true; break; }
        }
      }
      const discoveryPending = [...requests.map(request => request.key), "marketplaceUK", "retailBing", "pages", "children", "branchPages"].some(key => states[key]?.status === "pending");
      const remainingSearches = contentPending || contentQuotaExhausted || discoveryPending ? [] : specificationRequests(products);
      const specKeys = Object.keys(states).filter(key => /^specSearch\d*$/.test(key)).sort((a,b) => Number(a.slice(10) || 0)-Number(b.slice(10) || 0));
      const searched = new Set();
      let specsPending = false, specsQuotaExhausted = contentQuotaExhausted;
      async function collectSpecifications(key, searches) {
        await collect({ key, role: "retail", template: 15, values: { MainKeys: searches, Pagination_times: "1" } });
        states[key].requestedQueries = searches;
        searches.forEach(search => searched.add(search));
        specsPending ||= states[key].status === "pending";
        specsQuotaExhausted ||= states[key].code === "quota_exhausted";
        if (states[key].status === "pending") return;
        products = recoverIndexedSpecifications(products, rows[key] || []);
        const pageKey = key.replace("specSearch", "specPages");
        const links = states[pageKey]?.requestedUrls ?? merchantBalancedLinks((rows[key] || []).map(row => url(row.Detail_URL)).filter(link => link && !isSearchResultsUrl(link)), 30);
        if (links.length) {
          await collect({ key: pageKey, role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": links, "Wait Before Extraction (seconds)": "3" } });
          specsPending ||= states[pageKey].status === "pending";
          specsQuotaExhausted ||= states[pageKey].code === "quota_exhausted";
          products = recoverOctoparseSpecifications(products, htmlData(pageKey));
        }
      }
      for (const key of specKeys) await collectSpecifications(key, states[key].requestedQueries ?? remainingSearches);
      if (!specsPending && !specsQuotaExhausted) {
        // One Google page per query can produce many rows. Keep runs within
        // the 100-record export bound, and retain query identity as the cohort
        // grows; never resubmit searches already accepted on continuation.
        const searches = remainingSearches.filter(search => !searched.has(search));
        for (let first = 0, index = specKeys.length; first < searches.length; first += 5, index++) {
          await collectSpecifications(index ? `specSearch${index}` : "specSearch", searches.slice(first, first + 5));
          if (specsPending || specsQuotaExhausted) break;
        }
      }
    }
    if (catalogs.blocked.length || pages.blocked.length) sourceStatus.push({ source: "Retailer pages via Octoparse", status: "failed", code: "retailer_blocked" });
    jobs.set(cacheKey, states);
    const pending = sourceStatus.some(source => source.status === "pending");
    const nextPollAt = pending ? Math.min(...Object.values(states).filter(state => state.status === "pending").map(state => state.nextPollAt || Date.now()+15000)) : 0;
    const value = { products, places: octoparsePlaces(Object.entries(rows).filter(([key]) => /^branches\d*$/.test(key)).flatMap(([, batch]) => batch)), sourceStatus, diagnostics: { verified: products.length }, queryKey, ...(pending ? { continuation: signContinuation(Object.fromEntries(Object.entries(states).map(([key,state]) => [key,{...state,rows:undefined}])), queryKey, apiKey), nextPollAt } : {}) };
    if (!pending && !sourceStatus.some(source => source.status === "failed")) cache.set(cacheKey, { expires: Date.now()+900000, value });
    return value;
  })().finally(() => active.delete(cacheKey));
  active.set(cacheKey, operation);
  return operation;
}
