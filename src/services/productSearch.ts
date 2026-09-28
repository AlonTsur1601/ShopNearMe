import { facetValues } from "./facetValues";
import type { LocationPlace } from "../components/LocationModal";
import type { Facet, Offer, ShowcaseSearch } from "../types";

const demoQueries = /(sony|headphones?|wh-1000xm6)/i;
export function isShowcaseQuery(query: string) { return demoQueries.test(query.trim()); }
export type SearchScope = "online" | "local" | "local-products" | "all";

function genericFallback(query: string, warning = "Product search is temporarily unavailable."): ShowcaseSearch {
  return { query, resultCount: 0, offers: [], facets: [], source: "fallback", partialFailure: true, warnings: [warning] };
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

export async function searchProductScope(query: string, location: string, scope: SearchScope, signal?: AbortSignal, place?: LocationPlace, continuation?: string): Promise<ShowcaseSearch> {
  const params = new URLSearchParams({ q: query.trim(), location, scope });
  if (place) { params.set("lat", String(place.lat)); params.set("lon", String(place.lon)); }
  const response = continuation
    ? await fetch("/api/search", { signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(params), continuation }) })
    : await fetch(`/api/search?${params}`, { signal });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw Object.assign(new Error(typeof failure.error === "string" ? failure.error + (failure.resetAt ? ` It will reset ${failure.resetAt}.` : "") : `Search request failed (${response.status})`), { code: failure.code });
  }
  const result = await response.json() as ShowcaseSearch;
  if (!Array.isArray(result.offers) || !Array.isArray(result.facets)) throw new Error("Invalid search response");
  return { ...result, source: "live" };
}

function waitForProvider(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

const continuationStorageKey = "shopnearme-pending-searches";
type SavedSearch = { key: string; expiresAt: number; pending: NonNullable<ShowcaseSearch["pendingSearch"]> };
function savedSearches(): SavedSearch[] {
  try {
    const entries: unknown = JSON.parse(sessionStorage.getItem(continuationStorageKey) ?? "[]");
    return Array.isArray(entries) ? entries.filter((entry): entry is SavedSearch => entry && typeof entry.key === "string" && Number.isFinite(entry.expiresAt) && entry.expiresAt > Date.now() && typeof entry.pending?.continuation === "string" && entry.pending.continuation.length > 0 && Number.isFinite(entry.pending.nextPollAt)).slice(-5) : [];
  } catch { return []; }
}
function rememberSearch(key: string, pending?: ShowcaseSearch["pendingSearch"]) {
  try {
    const entries = savedSearches().filter(entry => entry.key !== key);
    if (pending) entries.push({ key, expiresAt: Date.now() + 15 * 60 * 1000, pending });
    sessionStorage.setItem(continuationStorageKey, JSON.stringify(entries.slice(-5)));
  } catch { /* Search still works when optional tab storage is unavailable. */ }
}

export async function searchProducts(query: string, location: string, signal?: AbortSignal, place?: LocationPlace): Promise<ShowcaseSearch> {
  const normalized = query.trim();
  const searchKey = JSON.stringify([normalized, location, place?.lat ?? null, place?.lon ?? null]);
  const pending = savedSearches().find(entry => entry.key === searchKey)?.pending;
  // Wait for the accepted cloud jobs to finish; only the caller can cancel
  // the overall search. Individual HTTP requests still have their own timeout.
  const budget = signal ?? new AbortController().signal;
  // Store only the server-signed job reference. Resumed products and facets
  // must come from a fresh server response, never from browser-cached offers.
  let result: ShowcaseSearch | undefined = pending ? { query: normalized, offers: [], facets: [], resultCount: 0, pendingSearch: pending } : undefined;
  let retries = 0;
  let restarted = false;
  try {
    do {
      if (result?.pendingSearch) await waitForProvider(Math.max(1000, result.pendingSearch.nextPollAt - Date.now()), budget);
      try {
        result = await searchProductScope(normalized, location, "all", AbortSignal.any([budget, AbortSignal.timeout(20000)]), place, result?.pendingSearch?.continuation);
        rememberSearch(searchKey, result.pendingSearch);
        retries = 0;
      } catch (error) {
        if (result?.pendingSearch && !restarted && error instanceof Error && "code" in error && error.code === "invalid_continuation") {
          rememberSearch(searchKey);
          result = undefined;
          restarted = true;
          continue;
        }
        // A continuation reads the same accepted jobs. A brief network failure
        // must not drop the products still being exported or start new jobs.
        const transient = error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError";
        if (!result?.pendingSearch || budget.aborted || !transient || retries++ >= 2) throw error;
        await waitForProvider(1000 * retries, budget);
        continue;
      }
    } while (!result || result.pendingSearch);
    return result;
  } catch (error) {
    if (signal?.aborted && signal.reason?.name !== "TimeoutError") throw error;
    const warning = budget.aborted || (error instanceof DOMException && error.name === "TimeoutError") ? "Some stores did not finish searching in time. Results are incomplete." : error instanceof Error ? error.message : "Search unavailable.";
    return result ? { ...result, pendingSearch: undefined, partialFailure: true, warnings: [...(result.warnings ?? []), warning] } : genericFallback(normalized, warning);
  }
}

export { genericFallback };
