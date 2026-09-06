const cache = new Map(), pending = new Map();
const TTL = 15 * 60 * 1000;
export async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const isSearch = new URL(url).hostname === "serpapi.com" && (!options.method || options.method === "GET");
  const key = isSearch ? String(url) : null;
  if (key && cache.get(key)?.expires > Date.now()) return cache.get(key).data;
  if (key && pending.has(key)) return pending.get(key);
  const request = (async () => {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), attempt ? Math.min(timeoutMs, 6000) : timeoutMs);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.error) {
          const error = new Error(data.error || "Provider returned " + response.status);
          error.status = response.status;
          throw error;
        }
        if (key && [data.shopping_results, data.local_results, data.organic_results, data.product_results?.stores].some(items => items?.length)) {
          if (cache.size >= 200) cache.delete(cache.keys().next().value);
          cache.set(key, { data, expires: Date.now() + TTL });
        }
        return data;
      } catch (error) {
        const temporary = error.name === "AbortError" || [408, 429, 500, 502, 503, 504].includes(error.status) || /fetch failed|network|temporar|timeout/i.test(error.message);
        if (!isSearch || attempt || !temporary || /quota|credits|run out|invalid api|unauthoriz/i.test(error.message)) throw error;
      } finally { clearTimeout(timer); }
    }
  })();
  if (key) pending.set(key, request);
  try { return await request; } finally { if (key) pending.delete(key); }
}
export async function mapConcurrent(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await operation(items[index], index); }
  }));
  return results;
}
import { brightDataSearch } from "./brightdata.mjs";

export async function searchProvider(params, config, timeoutMs = 15000) {
  // Keep the legacy interface for existing integration fixtures and older callers.
  // The deployed API supplies only the Bright Data configuration object.
  if (typeof config === "string") return fetchJson("https://serpapi.com/search.json?" + params, {}, timeoutMs);
  const engine = params.get("engine");
  const match = params.get("ll")?.match(/@(-?[\d.]+),(-?[\d.]+)/);
  const data = await brightDataSearch({
    query: params.get("q"), kind: engine === "google_maps" ? "maps" : engine === "google_shopping" ? "shopping" : "web",
    country: params.get("gl"), location: params.get("location"), start: Number(params.get("start") || 0),
    coordinates: match ? { lat: Number(match[1]), lon: Number(match[2]) } : undefined,
  }, config, engine === "google_maps" && !params.has("start") ? 25000 : timeoutMs);
  return {
    organic_results: (data.organic ?? []).map(item => ({ ...item, snippet: item.description, displayed_link: item.display_link, favicon: item.icon })),
    shopping_results: (data.shopping ?? []).map(item => ({ ...item, source: item.shop, thumbnail: item.image, source_icon: item.shop_logo, reviews: item.reviews_cnt, product_id: item.cid ?? item.rank })),
    local_results: (engine === "google_maps" ? data.organic ?? [] : Array.isArray(data.local) ? data.local : data.local?.places ?? data.places ?? []).map(item => ({
      ...item, title: item.title ?? item.name, type: Array.isArray(item.category) ? item.category.map(c => (c.id ?? c.title ?? "").replaceAll("_", " ")).join(" · ") : item.category ?? item.type, website: item.website ?? item.link ?? item.url,
      reviews: item.reviews_cnt ?? item.reviews, gps_coordinates: item.gps_coordinates ?? (item.latitude != null ? { latitude: item.latitude, longitude: item.longitude } : undefined),
      place_id: item.map_id_encoded ?? item.fid, google_maps_url: item.map_link,
    })),
  };
}
