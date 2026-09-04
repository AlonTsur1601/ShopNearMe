import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { searchCatalog } from "./server/search.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), { name: "shopnearme-search-api", configureServer(server) { server.middlewares.use("/api/search", async (request, response) => { const url = new URL(request.url ?? "", "http://localhost"); const query = url.searchParams.get("q")?.trim() ?? ""; const location = url.searchParams.get("location")?.trim() ?? ""; const scope = url.searchParams.get("scope") ?? "all"; const rawLat = url.searchParams.get("lat"); const rawLon = url.searchParams.get("lon"); const lat = Number(rawLat); const lon = Number(rawLon); const coordinates = rawLat !== null && rawLon !== null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined; response.setHeader("Content-Type", "application/json"); if (!query) { response.statusCode = 400; response.end(JSON.stringify({ error: "A product query is required" })); return; } try { response.end(JSON.stringify(await searchCatalog(query, location, env.SERPAPI_API_KEY, coordinates, { clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }, scope))); } catch (error) { response.statusCode = 502; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Search failed" })); } }); } }],
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["**/node_modules/**", "**/node_modules.partial-*/**", "**/dist/**"],
  },
  };
});
