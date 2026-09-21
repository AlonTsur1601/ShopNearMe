import { searchRetailCatalog } from "../server/search.mjs";
import { publicSearchError } from "../server/search-errors.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const query = String(request.query.q ?? "").trim();
  const location = String(request.query.location ?? "").trim();
  const lat = Number(request.query.lat); const lon = Number(request.query.lon);
  const scope = String(request.query.scope ?? "all");
  const coordinates = request.query.lat != null && request.query.lon != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  if (!query || query.length > 180) return response.status(400).json({ error: "A valid product query is required" });
  try {
    const result = await searchRetailCatalog(query, location, { provider: "octoparse", octoparseApiKey: process.env.OCTOPARSE_API_KEY, continuation: String(request.query.continuation ?? "") }, coordinates, {
      clientId: process.env.EBAY_CLIENT_ID,
      clientSecret: process.env.EBAY_CLIENT_SECRET,
    }, scope);
    response.setHeader("Cache-Control", result.pendingSearch || result.partialFailure || result.warnings?.length ? "no-store" : "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json(result);
  } catch (error) { response.setHeader("Cache-Control", "no-store"); return response.status(502).json(publicSearchError(error)); }
}
