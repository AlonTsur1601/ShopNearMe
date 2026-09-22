import { afterEach, expect, it, vi } from "vitest";

const searchCatalog = vi.fn();
vi.mock("../server/search.mjs", () => ({ searchCatalog }));
const { default: handler } = await import("./search.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("searches products without creating an Octoparse task", async () => {
  vi.stubEnv("SERPAPI_API_KEY", "search-key");
  searchCatalog.mockResolvedValue({ offers: [{ id: "merchant-product", itemPrice: 49, imageUrl: "https://shop.example/lamp.jpg" }], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp", location: "Kiryat Ono, Israel", scope: "all" } }, response);
  expect(searchCatalog).toHaveBeenCalledWith("bedside lamp", "Kiryat Ono, Israel", "search-key", undefined, expect.any(Object), "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ offers: [expect.objectContaining({ id: "merchant-product" })] }));
});

it("reports missing search configuration without creating an Octoparse task", async () => {
  vi.stubEnv("SERPAPI_API_KEY", "");
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp" } }, response);
  expect(searchCatalog).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(502);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "provider_not_configured" }));
});
