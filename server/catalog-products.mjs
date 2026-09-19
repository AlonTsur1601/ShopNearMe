import { load } from "cheerio";
import { budgetFetch } from "./search-budget.mjs";
import { readProductHtml } from "./product-page.mjs";

// A catalog is a discovery page, never an offer. Its linked products still pass
// the ordinary product-page, stock, price, image and relevance checks.
export async function catalogProductLinks(url, relevant) {
  try {
    const response = await budgetFetch(url, { signal: AbortSignal.timeout(2000), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("html")) return [];
    const base = new URL(response.url || url);
    const $ = load((await readProductHtml(response)).slice(0, 2000000));
    $("header, footer, nav, script, style").remove();
    const seen = new Set(), results = [];
    for (const anchor of $("a[href]").toArray()) {
      const title = [$(anchor).text(), $(anchor).attr("title"), $(anchor).find("img").attr("alt")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (!title || !relevant(title)) continue;
      let link;
      try { link = new URL($(anchor).attr("href"), base); } catch { continue; }
      if (link.origin !== base.origin || link.pathname === base.pathname || link.pathname === "/" || seen.has(link.href)) continue;
      if (/\/(?:cart|checkout|account|search)(?:\/|$)|[?&](?:add-to-cart|action)=/i.test(link.href)) continue;
      link.hash = "";
      seen.add(link.href); results.push({ title, link: link.href });
      if (results.length === 4) break;
    }
    return results;
  } catch { return []; }
}
