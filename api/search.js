import { searchRetailCatalog } from "../server/search.mjs";
import { publicSearchError } from "../server/search-errors.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const query = String(request.query.q ?? "").trim();
  const location = String(request.query.location ?? "").trim();
  const lat = Number(request.query.lat); const lon = Number(request.query.lon);
  const scope = String(request.query.scope ?? "all");
  const clientPoint = request.query.lat != null && request.query.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
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
    const credentials = {
      clientId: process.env.EBAY_CLIENT_ID,
      clientSecret: process.env.EBAY_CLIENT_SECRET,
    };
    const result = await searchRetailCatalog(query, approximateLocation, {
      apiKey: process.env.BRIGHTDATA_API_KEY,
      zone: process.env.BRIGHTDATA_SERP_ZONE,
      productZone: process.env.BRIGHTDATA_PRODUCT_ZONE,
      directRetailers: true,
    }, coordinates, credentials, scope);
    response.setHeader("Cache-Control", result.pendingSearch || result.partialFailure || result.warnings?.length ? "no-store" : "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json({ ...result, ...(approximatePoint ? { locationApproximate: true } : {}) });
  } catch (error) { response.setHeader("Cache-Control", "no-store"); return response.status(502).json(publicSearchError(error)); }
}
