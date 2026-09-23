import { createHash } from "node:crypto";
import { load } from "cheerio";
import { budgetFetch } from "./search-budget.mjs";
import { enrichProductPage, isSearchResultsUrl } from "./product-page.mjs";

// Search the stores' own catalogs. A store is queried for every product type;
// no category-to-retailer routing or store-directory rows are involved.
const stores = [
  { name: "Ivory", origin: "https://www.ivory.co.il", path: "/catalog.php?act=cat&q=", selector: "a[href$='.html']", card: anchor => anchor },
  { name: "LastPrice", origin: "https://www.lastprice.co.il", path: "/category.asp?q=", selector: ".infinite-item .tile a[href*='/p/']", card: anchor => anchor },
  { name: "ACE", origin: "https://www.ace.co.il", path: "/catalogsearch/result/?q=", selector: ".product-item", card: item => item.find("a.product-item-link, .product-item-name a").first() },
];

export async function searchRetailerSites({ query, localizedQuery = query, relevant, isCatalog, deadline }, dependencies = {}) {
  const fetchPage = dependencies.fetchPage ?? budgetFetch;
  const readProduct = dependencies.readProduct ?? enrichProductPage;
  const products = [], status = [];
  await Promise.allSettled(stores.map(async store => {
    const source = { source: store.name, status: "pending", candidates: 0, products: 0 };
    status.push(source);
    try {
      const url = store.origin + store.path + encodeURIComponent(localizedQuery);
      const response = await fetchPage(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("html")) throw new Error("Catalog unavailable");
      const $ = load((await response.text()).slice(0, 2000000));
      const links = new Map();
      for (const element of $(store.selector).toArray()) {
        const card = $(element), anchor = store.card(card);
        const title = anchor.text().replace(/\s+/g, " ").trim();
        if (!title || !relevant(title, query)) continue;
        let link;
        try { link = new URL(anchor.attr("href"), store.origin); } catch { continue; }
        if (link.origin !== store.origin || isSearchResultsUrl(link.href) || isCatalog(title, link.href) || links.has(link.href)) continue;
        // Catalog navigation may contain query words; it has no product card.
        if (store.name === "Ivory" && !/[₪\d]\s*₪|₪\s*\d|\b\d{2,}\s*₪/.test(card.text())) continue;
        links.set(link.href, { link: link.href, title });
        if (links.size === 4) break;
      }
      source.candidates = links.size;
      await Promise.allSettled([...links.values()].map(async item => {
        if (Date.now() + 400 >= deadline) return;
        const page = await readProduct(item.link);
        if (!page.isProduct || page.isCatalog || page.unavailable || /out of stock/i.test(page.availability ?? "") || !Number.isFinite(page.price) || page.price <= 0 || !page.imageUrl || !relevant(page.title || item.title, query)) return;
        products.push({ ...item, id: createHash("sha256").update(item.link).digest("hex").slice(0, 16), page });
        source.products++;
      }));
      source.status = "completed";
    } catch (error) { source.status = "failed"; source.code = /Timeout|Abort/.test(error.name) ? "search_timeout" : "retailer_unavailable"; }
  }));
  return { products, sourceStatus: status };
}
