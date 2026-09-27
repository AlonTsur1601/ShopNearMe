import { createHash } from "node:crypto";
import { load } from "cheerio";
import { extractProductData, isSearchResultsUrl } from "./product-page.mjs";
import { reuseOctoparseTask, readPoolTask } from "./octoparse-pool.mjs";
import { octoparseProducts, octoparsePlaces, signContinuation, readContinuation } from "./octoparse-discovery.mjs";
import { sameProductIdentity } from "./product-identity.mjs";
import { searchContext } from "./search-budget.mjs";

const cache = new Map();
const jobs = new Map();
const active = new Map();
const digest = value => createHash("sha256").update(value).digest("hex");
function url(value, base) {
  if (typeof value !== "string" || !value.trim() || /^(?:undefined|null)$/i.test(value.trim())) return "";
  try { const link = new URL(value, base); return /^https?:$/.test(link.protocol) && !link.username && !link.password ? link.href : ""; } catch { return ""; }
}
function priced(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/(?:USD|\$|ILS|₪|EUR|€|GBP|£)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:USD|\$|ILS|₪|EUR|€|GBP|£)/i);
  const price = match ? Number((match[1] || match[2]).replaceAll(",", "")) : NaN;
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
    for (const element of $(".product-item, .products .product, .product-grid .product, .grid__item, .product-card, .product_box, .ty-grid-list__item, [data-component-type='s-search-result'], .s-item, [itemtype$='/Product']").toArray()) {
      const card = $(element);
      card.find("del,s,.old-price,.a-text-price,.price--compare").remove();
      const anchor = card.find("a.product-item-link, .product-item-name a, a.s-item__link, a[href*='/dp/'], a[itemprop='url'], a.woocommerce-LoopProduct-link, .product__title a, a[href*='/products/']").first().length ? card.find("a.product-item-link, .product-item-name a, a.s-item__link, a[href*='/dp/'], a[itemprop='url'], a.woocommerce-LoopProduct-link, .product__title a, a[href*='/products/']").first() : card.find("a[href]").first();
      const itemLink = url(anchor.attr("href"), link);
      if (!itemLink) continue;
      const title = card.find(".product-item-name, .s-item__title, h2, h3, .product-name, .product-title, .ty-grid-list__item-name, [itemprop='name']").first().text().trim() || anchor.attr("title") || card.find("img").attr("alt");
      const priceNode = card.find("[data-price-type='finalPrice'], .a-price:not(.a-text-price) .a-offscreen, .s-item__price, [itemprop='price'], .price .woocommerce-Price-amount, .price__regular .price-item--regular, .price .money, .price, .ty-price-num").first();
      const amount = priceNode.attr("data-price-amount") || priceNode.attr("content");
      const display = priceNode.text().trim();
      const parsed = priced(display);
      const explicitCurrency = card.find("[itemprop='priceCurrency']").attr("content");
      const currency = explicitCurrency || parsed.currency || (new URL(link).hostname === "www.ace.co.il" && priceNode.attr("data-price-type") ? "ILS" : "");
      const price = amount && /^\d+(?:\.\d{1,2})?$/.test(amount) ? Number(amount) : parsed.price;
      const image = card.find("img").first();
      const imageUrl = url(image.attr("data-src") || image.attr("src"), link);
      const condition = card.find(".SECONDARY_INFO, .s-item__subtitle").first().text().trim();
      const item = { isProduct: true, title, price, currency, imageUrl, condition, specificationText: title, priceSource: "catalog", localEligible: !card.find(".external_seller").length };
      if (validProduct(item, itemLink, relevant, query) && !/out of stock|sold out|אזל המלאי/i.test(card.find(".stock, .availability").text())) products.set(itemLink, record(item, itemLink));
    }
    for (const anchor of $("a[href]").toArray()) {
      const node = $(anchor), href = url(node.attr("href"), link);
      if (!href) continue;
      const text = [node.text(),node.attr("title"),node.find("img").attr("alt")].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
      const branchPath = decodeURIComponent(new URL(href).pathname);
      if (new URL(href).origin === new URL(link).origin && (/(?:^|[\s/_-])(?:stores?|branches|branchs|סניפים|סניף)(?:$|[\s/_-])/i.test(branchPath) || /^(?:our stores|store locator|find a store|branches|הסניפים שלנו|סניפים|איתור סניף)$/i.test(text)) && !/cart|account|privacy/.test(href)) branchUrls.add(href);
      if (/waze\.com|maps\.google|google\.com\/maps/.test(href)) {
        const map = new URL(href), coordinates = (map.searchParams.get("ll") || map.searchParams.get("q") || "").split(",").map(Number);
        if (coordinates.length === 2 && coordinates.every(Number.isFinite) && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180) {
          const card = node.closest(".store-item, article, li, [itemscope]");
          const address = card.find("[itemprop=address], .address").text().trim() || card.children("p").first().text().trim();
          const places = locations.get(new URL(link).hostname) ?? [];
          places.push({ lat: coordinates[0], lon: coordinates[1], address, name: card.find("h2,h3").first().text().trim() });
          locations.set(new URL(link).hostname, places);
        }
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
    const matching = rows.filter(row => !row.error_message && url(row.url) === product.link && sameProductIdentity(product.title, row.title));
    const content = matching.flatMap(row => {
      if (row.format === "json") { try { return [JSON.parse(row.content).text || ""]; } catch { return []; } }
      return [String(row.content || "")];
    }).join("\n");
    return content ? { ...product, page: { ...product.page, specificationText: [product.page.specificationText, content].filter(Boolean).join("\n") } } : product;
  });
}

export async function discoverOctoparseCatalog({ query, country, localizedQuery = query, retailQuery, nearbyQuery, nearbyLocation, config, relevant, isCatalog = () => false, specificationRequests }, dependencies = {}) {
  const apiKey = config.octoparseApiKey;
  if (!apiKey) throw Object.assign(new Error("Octoparse is not configured"), { code: "provider_not_configured" });
  const queryKey = digest(`octoparse-pool-v1|${country}|${query}|${nearbyQuery || ""}`), cacheKey = digest(apiKey) + queryKey;
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
    const requests = [
      { key: "catalogs", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": catalogUrls.length ? catalogUrls : [`https://www.amazon.com/s?k=${encodeURIComponent(query)}`], "Wait Before Extraction (seconds)": "3" } },
      { key: "retail", role: "retail", template: 15, values: { MainKeys: [...new Set([retailQuery || `${query} price`, country === "IL" ? `${query} price site:.il` : `${query} price`])], Pagination_times: "1" } },
      { key: "amazon", role: "amazon-classic", template: 1153, values: { Site: "United States", "Confirm your site": ["https://www.amazon.com/"], "Keywords (up to 100,000)": [query], "Number of Pages to Scrape": "1" } },
      { key: "marketplace", role: "marketplace", template: 1063, values: { "123": "United States", "6tutxf6k2ik.List": ["https://www.ebay.com"], "1x7v90yy9yr.List": [query], "j4s3pig01g.ExecutedTimesLimitation": "1" } },
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
        state = state.deferred || state.snapshot || state.savedRows || state.status !== "pending" && state.rows ? state : state.status === "failed" && !state.taskId ? { ...state, rows: [] } : await read(state, apiKey);
        if (state.status !== "pending" && state.rows && !state.snapshot && !state.savedRows) {
          if (request.template === 1395) {
            const returned = new Set(state.rows.filter(row => row.Source_code).map(row => url(row.Original_URL)));
            state = { ...state, missingPages: (state.requestedUrls ?? []).filter(link => !returned.has(url(link))), snapshot: htmlSnapshot(productsFromOctoparseHtml(state.rows, relevant, query)), rows: [] };
          }
          else state = { ...state, savedRows: state.rows };
        }
        if (state.status === "failed" && !state.retryAt) state.retryAt = Date.now() + 30000;
        states[request.key] = state;
        rows[request.key] = state.savedRows ?? state.rows ?? [];
        sourceStatus.push({ source: `${request.key === "branches" ? "Nearby branches" : request.key === "pages" ? "Product pages" : request.key} via Octoparse`, status: state.status === "pending" ? "pending" : state.status === "failed" ? "failed" : state.collectedRows || rows[request.key].length || state.snapshot?.observations.length ? "completed" : "empty", ...(state.status === "failed" ? { code: state.code || "search_unavailable" } : {}) });
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
    const catalogs = htmlData("catalogs");
    // Retailer detail reads can run alongside marketplace collection. Waiting
    // for an unrelated slow marketplace before starting them serialized search.
    if (states.retail?.status !== "pending" && (states.retail?.status === "failed" || !(rows.retail || []).length)) await collect({ key: "retailBing", role: "retail-bing", template: 1471, values: { Country_Area: "United States - English", MainKeys: [retailQuery || `${query} price`], pagination: "1" } });
    const indexedLinks = [...(rows.retail || []), ...(rows.retailBing || [])].map(row => url(row.Detail_URL || row.URL || row.Url || row.Link)).filter(Boolean);
    const amazonProducts = octoparseProducts(rows.amazon || [], relevant, query), marketplaceProducts = octoparseMarketplaceRows(rows.marketplace || [], relevant, query);
    for (const [key, found] of [["amazon", amazonProducts], ["marketplace", marketplaceProducts]]) {
      const status = sourceStatus.find(source => source.source === `${key} via Octoparse`);
      if (status && ["completed", "empty"].includes(status.status)) status.status = found.length ? "completed" : "empty";
    }
    const baseProducts = [...catalogs.products, ...amazonProducts, ...marketplaceProducts];
    if (states.catalogs?.status !== "pending" && states.retail?.status !== "pending" && states.retailBing?.status !== "pending") {
      const alreadyPriced = new Set(baseProducts.map(product => product.link));
      const links = [...new Set([...catalogs.candidates, ...indexedLinks, ...catalogs.branchUrls])].filter(link => !alreadyPriced.has(link) && !/\/(?:cart|checkout|account)\b|(^|\.)google\.[a-z.]+\//.test(link)).slice(0,20);
      if (links.length) await collect({ key: "pages", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": links, "Wait Before Extraction (seconds)": "3" } });
      const detailPages = htmlData("pages");
      if (states.pages && states.pages.status !== "pending") {
        const hosts = new Map();
        const children = detailPages.candidates.filter(link => !links.includes(link) && !alreadyPriced.has(link) && !detailPages.products.some(product => product.link === link) && !isCatalog("",link)).filter(link => {
          const host = new URL(link).hostname, count = hosts.get(host) || 0;
          hosts.set(host,count+1); return count < 3;
        }).slice(0,12);
        if (children.length) await collect({ key: "children", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": children, "Wait Before Extraction (seconds)": "3" } });
      }
      const detailProducts = htmlData("pages", "children").products;
      if (states.children?.status !== "pending" && states.pages?.status !== "pending") {
        const branchLinks = [...new Set([...detailPages.branchUrls, ...htmlData("children").branchUrls])].filter(link => !links.includes(link)).slice(0,5);
        if (nearbyQuery && branchLinks.length) await collect({ key: "branchPages", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": branchLinks, "Wait Before Extraction (seconds)": "3" } });
      }
      if (nearbyQuery && states.children?.status !== "pending" && states.pages?.status !== "pending" && [...baseProducts, ...detailProducts].length) {
        const merchants = [...new Set([...baseProducts, ...detailProducts].filter(product => !/amazon\.|ebay\./.test(product.link)).map(product => new URL(product.link).hostname.replace(/^www\./,"")))].slice(0,5);
        if (merchants.length) await collect({ key: "branches", role: "branches", template: 686, values: { MainKeys: merchants.map(merchant => `${merchant} ${nearbyLocation || ""}`), PageSize: "1" } });
      }
    }
    const pages = htmlData("pages", "children", "branchPages");
    let products = recoverOctoparseSpecifications([...new Map([...baseProducts, ...pages.products].map(product => [product.link, product])).values()], pages);
    for (const product of products) {
      const found = catalogs.locations.get(new URL(product.link).hostname) ?? pages.locations.get(new URL(product.link).hostname);
      if (found) product.page.locations = found;
      if (/amazon\.|ebay\./.test(new URL(product.link).hostname)) product.page.localEligible = false;
    }
    // Retry missing properties against source pages for the same product.
    // Completion of discovery alone does not establish complete filter values.
    if (![...requests.map(request => request.key), "retailBing", "pages", "children", "branches", "branchPages"].some(key => states[key]?.status === "pending") && products.length && specificationRequests) {
      const searches = specificationRequests(products);
      if (searches.length) {
        // Every product gets a source-page recovery attempt. Reuse the content
        // slot sequentially in bounded batches; the former slice(0,20) skipped
        // the remaining products permanently when a marketplace returned more.
        let contentPending = false, contentQuotaExhausted = false;
        for (let first = 0; first < products.length; first += 20) {
          const key = first ? `content${first / 20}` : "content";
          await collect({ key, role: "content", template: 2113, values: { MainKeys: products.slice(first, first + 20).map(product => product.link), Depth: "0", Total_num: "1", Format: "markdown", Output_Field_Name: "content" } });
          products = recoverOctoparseContent(products, rows[key] || []);
          if (states[key]?.status === "pending") { contentPending = true; break; }
          if (states[key]?.code === "quota_exhausted") { contentQuotaExhausted = true; break; }
        }
        if (!contentPending && !contentQuotaExhausted && specificationRequests(products).length) {
        await collect({ key: "specSearch", role: "retail", template: 15, values: { MainKeys: searches, Pagination_times: "1" } });
        if (states.specSearch.status !== "pending") {
          const links = [...new Set((rows.specSearch || []).map(row => url(row.Detail_URL)).filter(link => link && !isSearchResultsUrl(link)))].slice(0,20);
          if (links.length) {
            await collect({ key: "specPages", role: "pages", template: 1395, values: { "URLs (up to 10,000 per run)": links, "Wait Before Extraction (seconds)": "3" } });
            products = recoverOctoparseSpecifications(products, htmlData("specPages"));
          }
        }
        }
      }
    }
    if (catalogs.blocked.length || pages.blocked.length) sourceStatus.push({ source: "Retailer pages via Octoparse", status: "failed", code: "retailer_blocked" });
    jobs.set(cacheKey, states);
    const pending = sourceStatus.some(source => source.status === "pending");
    const nextPollAt = pending ? Math.min(...Object.values(states).filter(state => state.status === "pending").map(state => state.nextPollAt || Date.now()+15000)) : 0;
    const value = { products, places: octoparsePlaces(rows.branches || []), sourceStatus, diagnostics: { verified: products.length }, ...(pending ? { continuation: signContinuation(Object.fromEntries(Object.entries(states).map(([key,state]) => [key,{...state,rows:undefined}])), queryKey, apiKey), nextPollAt } : {}) };
    if (!pending && !sourceStatus.some(source => source.status === "failed")) cache.set(cacheKey, { expires: Date.now()+900000, value });
    return value;
  })().finally(() => active.delete(cacheKey));
  active.set(cacheKey, operation);
  return operation;
}
