import { load } from "cheerio";
import { budgetFetch } from "./search-budget.mjs";
import { readProductHtml } from "./product-page.mjs";

// A catalog is a discovery page, never an offer. Its linked products still pass
// the ordinary product-page, stock, price, image and relevance checks.
export async function catalogProductLinks(url, relevant) {
  try {
    const response = await budgetFetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("html")) return [];
    const base = new URL(response.url || url);
    const $ = load((await readProductHtml(response)).slice(0, 2000000));
    $("header, footer, nav, script, style").remove();
    const categoryTitle = $("h1").first().text() || $("meta[property='og:title']").attr("content") || "";
    const seen = new Set(), results = [];
    for (const anchor of $("a[href]").toArray()) {
      const title = [$(anchor).text(), $(anchor).attr("title"), $(anchor).find("img").attr("alt")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!title || !relevant(`${title} ${categoryTitle}`)) continue;
      let link;
      try { link = new URL($(anchor).attr("href"), base); } catch { continue; }
      if (link.origin !== base.origin || link.pathname === base.pathname || link.pathname === "/" || seen.has(link.href)) continue;
      if (/\/(?:cart|checkout|account|search|category|categories|cat)(?:\/|$)|[?&](?:add-to-cart|action)=|[?&]act=cat(?:&|$)/i.test(link.href)) continue;
      link.hash = "";
      // Navigation often matches the query before the actual product cards.
      // Rank all candidates before applying the limit; never spend the whole
      // page budget on the first four category/sidebar links.
      const hasImage = $(anchor).find("img").length > 0;
      const hasPrice = /(?:[$€£₪]\s*\d|\d\s*[$€£₪])/.test(title);
      const productPath = /\/(?:products?|p|dp)\/|[?&](?:product_id|productId|pid)=/i.test(link.href);
      seen.add(link.href); results.push({ title, link: link.href, score: Number(hasImage) * 2 + Number(hasPrice) * 3 + Number(productPath) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 4).map(({ title, link }) => ({ title, link }));
  } catch { return []; }
}
