import { afterEach, expect, it, vi } from "vitest";

const searchRetailCatalog = vi.fn();
vi.mock("../server/search.mjs", () => ({ searchRetailCatalog }));
const { default: handler } = await import("./search.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("uses only Octoparse credentials and forwards cloud continuations", async () => {
  vi.stubEnv("OCTOPARSE_API_KEY", "octoparse-key");
  vi.stubEnv("BRIGHTDATA_API_KEY", "must-not-use");
  searchRetailCatalog.mockResolvedValue({ offers: [{ id: "merchant-product", itemPrice: 49, imageUrl: "https://shop.example/lamp.jpg" }], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp", location: "Kiryat Ono, Israel", scope: "all", continuation: "signed-lot" } }, response);
  expect(searchRetailCatalog).toHaveBeenCalledWith("bedside lamp", "Kiryat Ono, Israel", { provider: "octoparse", octoparseApiKey: "octoparse-key", continuation: "signed-lot" }, undefined, undefined, "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ offers: [expect.objectContaining({ id: "merchant-product" })] }));
});

it("does not silently use other providers when Octoparse is missing", async () => {
  vi.stubEnv("OCTOPARSE_API_KEY", "");
  searchRetailCatalog.mockResolvedValue({ offers: [{ id: "free-product", itemPrice: 49, imageUrl: "https://shop.example/lamp.jpg" }], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp" } }, response);
  expect(searchRetailCatalog).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(502);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_not_configured" }));
});

it("accepts a large signed continuation in the POST body", async () => {
  vi.stubEnv("OCTOPARSE_API_KEY", "octoparse-key");
  searchRetailCatalog.mockResolvedValue({ offers: [], facets: [], pendingSearch: { continuation: "next" } });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  const continuation = "x".repeat(160000);
  await handler({ method: "POST", body: { q: "lamp", location: "Israel", continuation } }, response);
  expect(searchRetailCatalog).toHaveBeenCalledWith("lamp", "Israel", expect.objectContaining({ continuation }), undefined, undefined, "all");
  expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
});

it("uses approximate Vercel location if browser coordinates are unavailable", async () => {
  vi.stubEnv("OCTOPARSE_API_KEY", "octoparse-key");
  searchRetailCatalog.mockResolvedValue({ offers: [], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "smart light bulb", location: "Current location" }, headers: { "x-vercel-ip-latitude": "32.06", "x-vercel-ip-longitude": "34.85", "x-vercel-ip-city": "Kiryat%20Ono", "x-vercel-ip-country": "IL" } }, response);
  expect(searchRetailCatalog).toHaveBeenCalledWith("smart light bulb", "Kiryat Ono, Israel", expect.any(Object), { lat: 32.06, lon: 34.85 }, undefined, "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ locationApproximate: true }));
});
