import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { publicSearchError } from "./server/search-errors.mjs";
import { searchRetailCatalog } from "./server/search.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), { name: "shopnearme-search-api", configureServer(server) {
    server.middlewares.use("/api/search", async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (!["GET", "POST"].includes(request.method || "")) { response.statusCode = 405; response.end(JSON.stringify({ error: "Method not allowed" })); return; }
      try {
        let input: Record<string, string>;
        if (request.method === "POST") {
          let body = "";
          for await (const chunk of request) { body += chunk; if (body.length > 1000000) throw new Error("Search continuation is too large"); }
          input = JSON.parse(body);
        } else input = Object.fromEntries(new URL(request.url ?? "", "http://localhost").searchParams);
        const query = String(input.q || "").trim(), location = String(input.location || "").trim();
        const lat = Number(input.lat), lon = Number(input.lon);
        const coordinates = input.lat != null && input.lon != null && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
        if (!query || query.length > 180) { response.statusCode = 400; response.end(JSON.stringify({ error: "A valid product query is required" })); return; }
        response.end(JSON.stringify(await searchRetailCatalog(query, location, { provider: "octoparse", octoparseApiKey: env.OCTOPARSE_API_KEY, continuation: input.continuation || "" }, coordinates, undefined, input.scope || "all")));
      } catch (error) { response.statusCode = 502; response.end(JSON.stringify(publicSearchError(error))); }
    });
  } }],
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
