import { load } from "cheerio";
import { budgetFetch } from "./search-budget.mjs";

export async function duckduckgoProducts(query, country, deadline, fetchPage = budgetFetch) {
  const terms = country === "IL" ? [`${query} רכישה חנות`, `${query} site:.il`] : [`${query} buy price`];
  const searches = await Promise.allSettled(terms.map(async term => {
    const url = "https://www.duckduckgo.com/html/?q=" + encodeURIComponent(term);
    const response = await fetchPage(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))), headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("html")) throw new Error("Search unavailable");
    const $ = load((await response.text()).slice(0, 1000000));
    return $(".result").slice(0, 12).map((_, element) => {
    const result = $(element), anchor = result.find(".result__a").first();
    let link = "";
    try { const redirect = new URL(anchor.attr("href"), "https://duckduckgo.com"); link = redirect.searchParams.get("uddg") || (redirect.hostname === "duckduckgo.com" ? "" : redirect.href); } catch { /* Invalid result */ }
    return { link, title: anchor.text().trim(), snippet: result.find(".result__snippet").text().trim() };
    }).get().filter(item => item.link && item.title);
  }));
  const organic = [...new Map(searches.flatMap(result => result.status === "fulfilled" ? result.value : []).map(item => [item.link, item])).values()];
  if (!organic.length && searches.every(result => result.status === "rejected")) throw searches[0].reason;
  return { organic };
}
