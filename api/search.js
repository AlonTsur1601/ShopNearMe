import { searchCatalog } from "../server/search.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });
  const query = String(request.query.q ?? "").trim();
  const location = String(request.query.location ?? "").trim();
  const lat = Number(request.query.lat); const lon = Number(request.query.lon);
  const coordinates = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  if (!query || query.length > 180) return response.status(400).json({ error: "A valid product query is required" });
  try {
    const result = await searchCatalog(query, location, process.env.SERPAPI_API_KEY, coordinates);
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json(result);
  } catch (error) { return response.status(502).json({ error: error instanceof Error ? error.message : "Search failed" }); }
}
