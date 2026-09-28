import { searchRetailCatalog } from "../server/search.mjs";
import { publicSearchError } from "../server/search-errors.mjs";

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return response.status(405).json({ error: "Method not allowed" });
  const input = request.method === "POST" ? request.body ?? {} : request.query;
  const query = String(input.q ?? "").trim();
  const location = String(input.location ?? "").trim();
  const lat = Number(input.lat); const lon = Number(input.lon);
  const scope = String(input.scope ?? "all");
  const clientPoint = input.lat != null && input.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
  const ipLat = Number(request.headers?.["x-vercel-ip-latitude"]), ipLon = Number(request.headers?.["x-vercel-ip-longitude"]);
  const approximatePoint = !clientPoint && location === "Current location" && request.headers?.["x-vercel-ip-latitude"] != null && request.headers?.["x-vercel-ip-longitude"] != null && Number.isFinite(ipLat) && Number.isFinite(ipLon) && Math.abs(ipLat) <= 90 && Math.abs(ipLon) <= 180 ? { lat: ipLat, lon: ipLon } : undefined;
  const coordinates = clientPoint ?? approximatePoint;
  const ipCity = String(request.headers?.["x-vercel-ip-city"] ?? "");
  const ipCountry = String(request.headers?.["x-vercel-ip-country"] ?? "");
  let approximateLocation = location;
  if (approximatePoint && ipCity && /^[A-Z]{2}$/.test(ipCountry)) {
    try { approximateLocation = `${decodeURIComponent(ipCity)}, ${new Intl.DisplayNames(["en"], { type: "region" }).of(ipCountry)}`; } catch { /* Use coordinates when the city header is malformed. */ }
  }
  if (!query || query.length > 180) return response.status(400).json({ error: "A valid product query is required" });
  try {
    if (!process.env.BRIGHTDATA_API_KEY || !process.env.BRIGHTDATA_SERP_ZONE) throw Object.assign(new Error("Bright Data is not configured"), { code: "provider_not_configured" });
    const result = await searchRetailCatalog(query, approximateLocation, {
      provider: "brightdata",
      apiKey: process.env.BRIGHTDATA_API_KEY,
      zone: process.env.BRIGHTDATA_SERP_ZONE,
    }, coordinates, { clientId: process.env.EBAY_CLIENT_ID, clientSecret: process.env.EBAY_CLIENT_SECRET }, scope);
    response.setHeader("Cache-Control", result.pendingSearch || result.partialFailure || result.warnings?.length ? "no-store" : "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json({ ...result, ...(approximatePoint ? { locationApproximate: true } : {}) });
  } catch (error) { response.setHeader("Cache-Control", "no-store"); return response.status(502).json(publicSearchError(error)); }
}
