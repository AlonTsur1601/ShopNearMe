import { createHash } from "node:crypto";
import { load } from "cheerio";
import { budgetFetch } from "./search-budget.mjs";
import { enrichProductPage, extractProductData, isSearchResultsUrl, readProductHtml } from "./product-page.mjs";

// Search the stores' own catalogs. A store is queried for every product type;
// no category-to-retailer routing or store-directory rows are involved.
const stores = [
  { name: "Ivory", origin: "https://www.ivory.co.il", path: "/catalog.php?act=cat&q=", selector: "a[href$='.html']", card: anchor => anchor },
  { name: "LastPrice", origin: "https://www.lastprice.co.il", path: "/category.asp?q=", selector: ".infinite-item .tile a[href*='/p/']", card: anchor => anchor },
  { name: "ACE", origin: "https://www.ace.co.il", path: "/catalogsearch/result/?q=", selector: ".product-item", card: item => item.find(".product-item-name").closest("a").add(item.find("a.product-item-link, .product-item-name a")).first() },
  { name: "Amazon", origin: "https://www.amazon.com", path: "/s?k=", selector: '[data-component-type="s-search-result"][data-asin]', card: item => item.find('a[href*="/dp/"]').first(), originalQuery: true },
];

let branchCache;
async function aceBranches(fetchPage, deadline, cache = true) {
  if (cache && branchCache?.expires > Date.now()) return branchCache.locations;
  try {
    const response = await fetchPage("https://www.ace.co.il/stores", { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(Math.max(1, Math.min(3000, deadline - Date.now()))) });
    if (!response.ok) return [];
    const $ = load(await readProductHtml(response)), locations = [];
    for (const element of $(".store-item").toArray()) {
      const card = $(element);
      if (!/\bACE\b/i.test(card.find(".wrap-title p").text())) continue;
      let coordinates;
      try { coordinates = new URL(card.find("a.waze").attr("href")).searchParams.get("ll")?.split(",").map(Number); } catch { continue; }
      if (coordinates?.length !== 2 || !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) continue;
      locations.push({ name: card.find("h2").text().trim(), address: card.children("p").first().text().trim(), lat: coordinates[0], lon: coordinates[1] });
    }
    if (cache && locations.length) branchCache = { locations, expires: Date.now() + 3600000 };
    return locations;
  } catch { return []; }
}

function catalogProduct($, card, store, link, title) {
  if (store.name === "ACE") {
    // Each ItemList entry carries its own Product/Offer, unlike the catalog's
    // page-wide metadata. Never assign one card another card's price or image.
    for (const script of $('script[type="application/ld+json"]').toArray()) {
      let data;
      try { data = JSON.parse($(script).text()); } catch { continue; }
      const lists = [data].flat().flatMap(item => item?.["@graph"] ?? [item]);
      for (const list of lists) for (const entry of list?.itemListElement ?? []) {
        const product = entry.item;
        if (!product || product.url !== link) continue;
        const page = extractProductData(`<script type="application/ld+json">${JSON.stringify(product)}</script>`, link);
        return { ...page, condition: "New", localEligible: !card.find(".external_seller").length, priceSource: "catalog" };
      }
    }
    const price = Number(card.find('[data-price-type="finalPrice"] .priceNum').first().text().replace(/[^\d.]/g, ""));
    const imageUrl = card.find("img.product-image-photo").attr("src");
    return { isProduct: true, destinationUrl: link, title, price, currency: "ILS", imageUrl, brand: card.find(".product-item-brand").text().trim(), condition: "New", localEligible: !card.find(".external_seller").length, priceSource: "catalog" };
  }
  if (store.name === "Amazon") {
    const text = card.find(".a-price:not(.a-text-price) .a-offscreen").first().text().trim();
    const currency = /ILS|₪/.test(text) ? "ILS" : /USD|\$/.test(text) ? "USD" : /EUR|€/.test(text) ? "EUR" : /GBP|£/.test(text) ? "GBP" : "";
    const price = Number(text.replace(/[^\d.]/g, ""));
    return { isProduct: true, destinationUrl: link, title, price: currency ? price : null, currency, imageUrl: card.find("img.s-image").attr("src"), specificationText: title, localEligible: false, priceSource: "catalog" };
  }
  return {};
}

export async function searchRetailerSites({ query, country = "IL", localizedQuery = query, relevant, isCatalog, deadline }, dependencies = {}) {
  const fetchPage = dependencies.fetchPage ?? budgetFetch;
  const readProduct = dependencies.readProduct ?? enrichProductPage;
  const products = [], status = [];
  const selectedStores = country === "IL" ? stores : stores.filter(store => store.name === "Amazon");
  const jobs = selectedStores.map(async store => {
    const source = { source: store.name, status: "pending", candidates: 0, products: 0 };
    status.push(source);
    try {
      const branches = store.name === "ACE" ? aceBranches(fetchPage, deadline, !dependencies.fetchPage) : Promise.resolve([]);
      const url = store.origin + store.path + encodeURIComponent(store.originalQuery ? query : localizedQuery);
      const response = await fetchPage(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("html")) throw new Error("Catalog unavailable");
      const $ = load((await readProductHtml(response)).slice(0, 3000000));
      const links = new Map();
      for (const element of $(store.selector).toArray()) {
        const card = $(element), anchor = store.card(card);
        const title = (store.name === "Amazon" ? card.find("h2").text() : anchor.text()).replace(/\s+/g, " ").trim();
        if (!title || !relevant(title, query)) continue;
        let link;
        try { link = new URL(anchor.attr("href"), store.origin); } catch { continue; }
        if (store.name === "Amazon") {
          const asin = card.attr("data-asin");
          if (!/^[A-Z0-9]{10}$/.test(asin ?? "")) continue;
          link = new URL(`/dp/${asin}`, store.origin);
        }
        if (link.origin !== store.origin || isSearchResultsUrl(link.href) || isCatalog(title, link.href) || links.has(link.href)) continue;
        // Catalog navigation may contain query words; it has no product card.
        if (store.name === "Ivory" && !/[₪\d]\s*₪|₪\s*\d|\b\d{2,}\s*₪/.test(card.text())) continue;
        links.set(link.href, { link: link.href, title, catalog: catalogProduct($, card, store, link.href, title) });
        if (links.size === 4) break;
      }
      source.candidates = links.size;
      await Promise.allSettled([...links.values()].map(async item => {
        if (Date.now() + 400 >= deadline) return;
        const detail = await readProduct(item.link);
        if (detail.unavailable || detail.isCatalog || /out of stock/i.test(detail.availability ?? "")) return;
        const page = detail.isProduct ? { ...item.catalog, ...detail, price: detail.price ?? item.catalog.price, currency: detail.price != null ? detail.currency : item.catalog.currency, imageUrl: detail.imageUrl || item.catalog.imageUrl } : item.catalog;
        if (!page.isProduct || page.isCatalog || page.unavailable || /out of stock/i.test(page.availability ?? "") || !Number.isFinite(page.price) || page.price <= 0 || !page.imageUrl || !relevant(page.title || item.title, query)) return;
        if (store.name === "ACE" && page.localEligible !== false) page.locations = [...(page.locations ?? []), ...await branches];
        products.push({ link: item.link, title: item.title, id: createHash("sha256").update(item.link).digest("hex").slice(0, 16), page });
        source.products++;
      }));
      source.status = "completed";
    } catch (error) { source.status = "failed"; source.code = /Timeout|Abort/.test(error.name) ? "search_timeout" : "retailer_unavailable"; }
  });
  if (country === "IL") jobs.push((async () => {
    const source = { source: "IKEA", status: "pending", candidates: 0, products: 0 };
    status.push(source);
    try {
      const response = await fetchPage("https://sik.search.blue.cdtapps.com/il/he/search", {
        method: "POST", headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
        body: JSON.stringify({ searchParameters: { input: query, type: "QUERY" }, allowAutocorrect: false, components: [{ component: "PRIMARY_AREA", types: { main: "PRODUCT", breakouts: [] }, window: { size: 8, offset: 0 }, filterConfig: {} }] }),
      });
      if (!response.ok) throw new Error("Catalog unavailable");
      const data = await response.json();
      for (const item of (data.results ?? []).flatMap(result => result.items ?? [])) {
        const product = item.product;
        if (!product || item.type !== "PRODUCT") continue;
        const title = `${product.name} ${product.typeName} ${product.validDesignText ?? ""}`.trim();
        const evidence = `${title} ${product.filterClass ?? ""} ${product.mainImageAlt ?? ""}`;
        if (!relevant(evidence, query)) continue;
        let link;
        try { link = new URL(product.pipUrl); } catch { continue; }
        if (link.hostname !== "www.ikea.com" || !link.pathname.startsWith("/il/he/p/")) continue;
        const price = product.salesPrice?.numeral, currency = product.salesPrice?.currencyCode;
        if (!Number.isFinite(price) || price <= 0 || currency !== "ILS" || !product.mainImageUrl) continue;
        source.candidates++;
        const page = { isProduct: true, destinationUrl: link.href, title, price, currency, imageUrl: product.mainImageUrl, brand: "IKEA", condition: "New", inStoreOnly: product.onlineSellable === false, localEligible: true, priceSource: "catalog", specificationText: evidence, specifications: [{ name: "Color", value: (product.colors ?? []).map(color => color.name) }] };
        products.push({ link: link.href, title, id: createHash("sha256").update(link.href).digest("hex").slice(0, 16), page });
        source.products++;
      }
      source.status = "completed";
    } catch (error) { source.status = "failed"; source.code = /Timeout|Abort/.test(error.name) ? "search_timeout" : "retailer_unavailable"; }
  })());
  await Promise.allSettled(jobs);
  return { products, sourceStatus: status };
}
