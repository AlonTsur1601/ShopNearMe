import { getShowcase } from "../data/showcase";
import type { LocationPlace } from "../components/LocationModal";
import type { Facet, Offer, ShowcaseSearch } from "../types";

const demoQueries = /(sony|headphones?|wh-1000xm6)/i;
export function isShowcaseQuery(query: string) { return demoQueries.test(query.trim()); }
export type SearchScope = "online" | "local" | "local-products" | "all";

function placeholder(query: string) {
  const label = query.trim().slice(0, 2).toUpperCase().replace(/[<>&]/g, "") || "SN";
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" rx="12" fill="#f3f7f8"/><circle cx="80" cy="54" r="26" fill="#d7eeee"/><text x="80" y="63" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#007b83">${label}</text><text x="80" y="99" text-anchor="middle" font-family="Arial" font-size="10" fill="#5d6675">Product search</text></svg>`)}`;
}

function genericFallback(query: string): ShowcaseSearch {
  const encoded = encodeURIComponent(query), imageUrl = placeholder(query);
  const merchants = [["Google Shopping", `https://www.google.com/search?tbm=shop&q=${encoded}`], ["eBay", `https://www.ebay.com/sch/i.html?_nkw=${encoded}`], ["Walmart", `https://www.walmart.com/search?q=${encoded}`]] as const;
  const offers: Offer[] = merchants.map(([merchant, destinationUrl], index) => ({ id: `fallback-${index}`, category: index === 1 ? "secondHand" : "order", merchant, title: `${query} offers`, subtitle: index === 1 ? "New and pre-owned listings" : "Browse matching products", imageUrl, rating: 0, reviewCount: 0, itemPrice: null, shippingPrice: null, totalPrice: null, priceVerified: false, availability: "Open retailer", attributes: { retailer: merchant, condition: index === 1 ? "Used" : "New" }, destinationUrl, linkLabel: "Search retailer" }));
  return { query, resultCount: offers.length, offers, facets: [{ id: "retailer", label: "Retailer", options: merchants.map(([value]) => ({ value, count: 1 })) }, { id: "condition", label: "Condition", options: [{ value: "New", count: 2 }, { value: "Used", count: 1 }] }], source: "fallback" };
}

function facetsFor(offers: Offer[], results: ShowcaseSearch[]): Facet[] {
  const labels = new Map(results.flatMap((result) => result.facets.map((facet) => [facet.id, facet.label] as const)));
  return [...labels].map(([id, label]) => {
    const counts = new Map<string, number>();
    for (const offer of offers) { const value = offer.attributes[id]; if (value) counts.set(value, (counts.get(value) ?? 0) + 1); }
    return { id, label, options: [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
  }).filter((facet) => facet.options.length >= 2);
}

export function mergeSearchResults(query: string, results: ShowcaseSearch[]): ShowcaseSearch {
  const ordered = results.flatMap((result) => result.offers).sort((a, b) => ({ local: 0, order: 1, secondHand: 2 }[a.category] - { local: 0, order: 1, secondHand: 2 }[b.category]));
  const seen = new Set<string>();
  const offers = ordered.filter((offer) => { const key = `${offer.category}|${offer.destinationUrl}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return { query, offers, resultCount: offers.length, facets: facetsFor(offers, results), source: results.some((result) => result.source === "live") ? "live" : results[0]?.source ?? "fallback" };
}

export async function searchProductScope(query: string, location: string, scope: SearchScope, signal?: AbortSignal, place?: LocationPlace): Promise<ShowcaseSearch> {
  const params = new URLSearchParams({ q: query.trim(), location, scope });
  if (place) { params.set("lat", String(place.lat)); params.set("lon", String(place.lon)); }
  const response = await fetch(`/api/search?${params}`, { signal });
  if (!response.ok) throw new Error(`Search request failed (${response.status})`);
  const result = await response.json() as ShowcaseSearch;
  if (!Array.isArray(result.offers) || !Array.isArray(result.facets)) throw new Error("Invalid search response");
  return { ...result, source: "live" };
}

export async function searchProducts(query: string, location: string, signal?: AbortSignal, place?: LocationPlace): Promise<ShowcaseSearch> {
  const normalized = query.trim();
  if (demoQueries.test(normalized)) return { ...getShowcase(normalized), source: "showcase" };
  try { return await searchProductScope(normalized, location, "all", signal, place); }
  catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; return genericFallback(normalized); }
}

export { genericFallback };
