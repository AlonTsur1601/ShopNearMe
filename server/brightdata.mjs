import { createHash } from "node:crypto";

const cache = new Map(), pending = new Map();
const TTL = 15 * 60 * 1000;

// This client is server-only. A zone must be explicitly configured, never guessed.
export function brightDataSearchUrl({ query, kind = "web", country, location, coordinates, start = 0 }) {
  if (!["web", "shopping", "maps"].includes(kind)) throw new Error("Unsupported search kind");
  if (!String(query ?? "").trim()) throw new Error("A search query is required");
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("brd_json", "1");
  if (/^[a-z]{2}$/i.test(country ?? "")) url.searchParams.set("gl", country.toLowerCase());
  if (Number.isInteger(start) && start > 0) url.searchParams.set("start", String(start));
  if (kind === "shopping") url.searchParams.set("tbm", "shop");
  if (kind === "maps") {
    const point = coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon)
      && Math.abs(coordinates.lat) <= 90 && Math.abs(coordinates.lon) <= 180 ? coordinates : null;
    const term = query + (location && location !== "Current location" ? " near " + location : "");
    url.pathname = "/maps/search/" + encodeURIComponent(term) + "/" + (point ? "@" + point.lat + "," + point.lon + ",14z" : "");
    url.searchParams.delete("q");
  } else if (location && location !== "Current location") {
    // Google's canonical-location UULE wire format (length is UTF-8 bytes).
    const bytes = Buffer.from(location);
    if (bytes.length < 64) url.searchParams.set("uule", "w+CAIQICI" + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[bytes.length] + bytes.toString("base64"));
  }
  return url.href;
}

export async function brightDataSearch(request, config, timeoutMs = 20000) {
  if (!config?.apiKey) throw new Error("BRIGHTDATA_API_KEY is not configured");
  if (!config?.zone) throw new Error("BRIGHTDATA_SERP_ZONE is not configured");
  const url = brightDataSearchUrl(request);
  const key = createHash("sha256").update(config.apiKey + "|" + config.zone + "|" + url).digest("hex");
  if (cache.get(key)?.expires > Date.now()) return cache.get(key).data;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ zone: config.zone, url, format: "json" }),
          signal: AbortSignal.timeout(attempt ? Math.min(timeoutMs, 6000) : timeoutMs),
        });
        // Never expose upstream error text: it may echo request credentials.
        if (!response.ok) {
          const error = new Error("Bright Data search failed (HTTP " + response.status + ")");
          error.status = response.status;
          throw error;
        }
        let data;
        try { data = JSON.parse(await response.text()); }
        catch { throw new Error("Bright Data did not return parsed search data"); }
        if (data?.status_code && data.status_code !== 200) {
          const error = new Error("Bright Data upstream search failed (HTTP " + data.status_code + ")");
          error.status = data.status_code; throw error;
        }
        if (typeof data?.body === "string") {
          try { data = JSON.parse(data.body); }
          catch { throw new Error("Bright Data did not return parsed search data"); }
        }
        if (!data || typeof data !== "object" || Array.isArray(data) || data.error) throw new Error("Bright Data returned an invalid search response");
        // Unknown schemas/empty results are deliberately not cached as successes.
        if ([data.organic, data.shopping, data.local, data.places].some(items => Array.isArray(items) && items.length)) {
          if (cache.size >= 200) cache.delete(cache.keys().next().value);
          cache.set(key, { data, expires: Date.now() + TTL });
        }
        return data;
      } catch (error) {
        const temporary = [408, 429, 500, 502, 503, 504].includes(error.status) || ["TimeoutError", "AbortError"].includes(error.name) || /fetch failed|network|did not return parsed/i.test(error.message);
        if (attempt || !temporary) throw error;
      }
    }
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
