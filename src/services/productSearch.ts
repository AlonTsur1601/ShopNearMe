import { facetValues } from "./facetValues";
import type { LocationPlace } from "../components/LocationModal";
import type { Facet, Offer, ShowcaseSearch } from "../types";

const demoQueries = /(sony|headphones?|wh-1000xm6)/i;
export function isShowcaseQuery(query: string) { return demoQueries.test(query.trim()); }
export type SearchScope = "online" | "local" | "local-products" | "all";

function genericFallback(query: string): ShowcaseSearch {
  return { query, resultCount: 0, offers: [], facets: [], source: "fallback" };
}

function facetsFor(offers: Offer[], results: ShowcaseSearch[]): Facet[] {
  const labels = new Map(results.flatMap((result) => result.facets.map((facet) => [facet.id, facet.label] as const)));
  return [...labels].map(([id, label]) => {
    const counts = new Map<string, number>();
    for (const offer of offers) for (const value of new Set(facetValues(offer.attributes[id]))) counts.set(value, (counts.get(value) ?? 0) + 1);
    return { id, label, options: [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
  }).filter((facet) => facet.options.length > 0);
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
  try { return await searchProductScope(normalized, location, "all", signal, place); }
  catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; return genericFallback(normalized); }
}

export { genericFallback };
