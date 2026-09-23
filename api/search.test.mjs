import { afterEach, expect, it, vi } from "vitest";

const searchRetailCatalog = vi.fn();
vi.mock("../server/search.mjs", () => ({ searchRetailCatalog }));
const { default: handler } = await import("./search.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("searches products without creating an Octoparse task", async () => {
  vi.stubEnv("BRIGHTDATA_API_KEY", "search-key");
  vi.stubEnv("BRIGHTDATA_SERP_ZONE", "search-zone");
  searchRetailCatalog.mockResolvedValue({ offers: [{ id: "merchant-product", itemPrice: 49, imageUrl: "https://shop.example/lamp.jpg" }], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp", location: "Kiryat Ono, Israel", scope: "all" } }, response);
  expect(searchRetailCatalog).toHaveBeenCalledWith("bedside lamp", "Kiryat Ono, Israel", { apiKey: "search-key", zone: "search-zone" }, undefined, expect.any(Object), "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ offers: [expect.objectContaining({ id: "merchant-product" })] }));
});

it("reports missing search configuration without creating an Octoparse task", async () => {
  vi.stubEnv("BRIGHTDATA_API_KEY", "");
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp" } }, response);
  expect(searchRetailCatalog).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(502);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_not_configured" }));
});

it("uses approximate Vercel location if browser coordinates are unavailable", async () => {
  vi.stubEnv("BRIGHTDATA_API_KEY", "search-key");
  vi.stubEnv("BRIGHTDATA_SERP_ZONE", "search-zone");
  searchRetailCatalog.mockResolvedValue({ offers: [], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "smart light bulb", location: "Current location" }, headers: { "x-vercel-ip-latitude": "32.06", "x-vercel-ip-longitude": "34.85", "x-vercel-ip-city": "Kiryat%20Ono", "x-vercel-ip-country": "IL" } }, response);
  expect(searchRetailCatalog).toHaveBeenCalledWith("smart light bulb", "Kiryat Ono, Israel", expect.any(Object), { lat: 32.06, lon: 34.85 }, expect.any(Object), "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ locationApproximate: true }));
});
