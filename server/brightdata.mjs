import { budgetFetch, searchContext } from "./search-budget.mjs";
import { createHash } from "node:crypto";

const cache = new Map(), pending = new Map();
const cooldowns = new Map();
const TTL = 15 * 60 * 1000;

function providerError(status, headers = {}, message = "Bright Data search failed") {
  const get = name => typeof headers.get === "function" ? headers.get(name) : Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const upstream = get("x-brd-error-code") || get("x-brd-err-code");
  const error = Object.assign(new Error(message + " (HTTP " + status + ")"), { status });
  if (["captcha", "verifying"].includes(upstream)) error.code = "source_blocked";
  if (status === 429) error.code = "source_rate_limited";
  if (error.code) error.retryAfterMs = Math.max(15000, Math.min(300000, Number(get("x-brd-rate-limit-period-ms")) || 0));
  return error;
}

// This client is server-only. A zone must be explicitly configured, never guessed.
export function brightDataSearchUrl({ query, kind = "web", country, language = "en", location, coordinates, start = 0, engine = "google", light = false }) {
  if (!["web", "shopping", "maps"].includes(kind)) throw new Error("Unsupported search kind");
  if (!String(query ?? "").trim()) throw new Error("A search query is required");
  if (!["google", "bing"].includes(engine) || (engine === "bing" && kind !== "web")) throw new Error("Unsupported search engine");
  const url = new URL(engine === "bing" ? "https://www.bing.com/search" : "https://www.google.com/search");
  url.searchParams.set("q", query);
  if (engine === "bing") {
    url.searchParams.set("brd_json", "1");
    url.searchParams.set("setlang", /^[a-z]{2}$/i.test(language) ? language : "en");
    if (/^[a-z]{2}$/i.test(country ?? "")) url.searchParams.set("cc", country.toLowerCase());
    return url.href;
  }
  url.searchParams.set("hl", /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(language) ? language : "en");
  url.searchParams.set("brd_json", light ? "parsed_light" : "1");
  url.searchParams.set("brd_browser", "chrome");
  if (/^[a-z]{2}$/i.test(country ?? "")) url.searchParams.set("gl", country.toLowerCase());
  if (Number.isInteger(start) && start > 0) url.searchParams.set("start", String(start));
  if (kind === "shopping") url.searchParams.set("udm", "28");
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
  const source = request.engine === "bing" ? "bing:web" : request.kind || "web";
  const key = createHash("sha256").update(config.apiKey + "|" + config.zone + "|" + url).digest("hex");
  if (cache.get(key)?.expires > Date.now()) return cache.get(key).data;
  if (cooldowns.get(key)?.until > Date.now()) throw cooldowns.get(key).error;
  cooldowns.delete(key);
  if (searchContext()?.providerFailure) throw searchContext().providerFailure;
  if (searchContext()?.providerFailures.has(source)) throw searchContext().providerFailures.get(source);
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await budgetFetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ zone: config.zone, url, format: "json" }),
          signal: AbortSignal.timeout(attempt ? Math.min(timeoutMs, 1500) : timeoutMs),
        });
        // Never expose upstream error text: it may echo request credentials.
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const error = providerError(response.status, response.headers);
          if (response.status === 402 || /(?:quota|credit|balance|limit).{0,30}(?:exhaust|exceed|insufficient|deplet|used)/i.test(body)) {
            error.code = "quota_exhausted";
            const reset = response.headers.get("x-ratelimit-reset") || response.headers.get("ratelimit-reset") || response.headers.get("retry-after");
            if (reset && /^\d+$/.test(reset)) error.resetAt = new Date((Number(reset) > 1e9 ? Number(reset) * 1000 : Date.now() + Number(reset) * 1000)).toISOString();
          }
          throw error;
        }
        let data;
        try { data = JSON.parse(await response.text()); }
        catch { throw new Error("Bright Data did not return parsed search data"); }
        if (data?.status_code && data.status_code !== 200) {
          const error = providerError(data.status_code, data.headers, "Bright Data upstream search failed");
          if (data.status_code === 402 || /(?:quota|credit|balance|limit).{0,30}(?:exhaust|exceed|insufficient|deplet|used)/i.test(String(data.message ?? data.error ?? ""))) error.code = "quota_exhausted";
          throw error;
        }
        if (typeof data?.body === "string") {
          try { data = JSON.parse(data.body); }
          catch { throw new Error("Bright Data did not return parsed search data"); }
        }
        if (!data || typeof data !== "object" || Array.isArray(data) || data.error) throw new Error("Bright Data returned an invalid search response");
        if (!["organic", "shopping", "top_pla", "bottom_pla", "jackpot_pla", "local", "places", "snack_pack"].some(field => Object.hasOwn(data, field))) throw new Error("Bright Data returned an unrecognized search response");
        // Unknown schemas/empty results are deliberately not cached as successes.
        if ([data.organic, data.shopping, data.top_pla, data.bottom_pla, data.jackpot_pla, data.local, data.places, data.snack_pack].some(items => (Array.isArray(items) ? items : items?.places ?? items?.results)?.length)) {
          if (cache.size >= 200) cache.delete(cache.keys().next().value);
          cache.set(key, { data, expires: Date.now() + TTL });
        }
        return data;
      } catch (error) {
        if (error.retryAfterMs) {
          if (cooldowns.size >= 200) cooldowns.delete(cooldowns.keys().next().value);
          cooldowns.set(key, { until: Date.now() + error.retryAfterMs, error });
        }
        if (searchContext() && error.code === "quota_exhausted") searchContext().providerFailure = error;
        if (searchContext() && error.code === "source_blocked") searchContext().providerFailures.set(source, error);
        if (searchContext()?.signal.aborted) throw searchContext().signal.reason;
        const temporary = [408, 429, 500, 502, 503, 504].includes(error.status) || /fetch failed|network|did not return parsed/i.test(error.message);
        if (request.noRetry || attempt || !temporary || error.retryAfterMs) throw error;
      }
    }
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
