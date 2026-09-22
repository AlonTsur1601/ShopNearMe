import { afterEach, expect, it, vi } from "vitest";

const searchRetailCatalog = vi.fn();
const searchCatalog = vi.fn();
vi.mock("../server/search.mjs", () => ({ searchRetailCatalog, searchCatalog }));
const { default: handler } = await import("./search.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("uses the existing product search when Octoparse cannot create another task", async () => {
  vi.stubEnv("SERPAPI_API_KEY", "backup-key");
  searchRetailCatalog.mockResolvedValue({ offers: [{ id: "ebay-only" }], facets: [], discoveryStatus: [{ code: "task_limit_reached" }, { code: "task_limit_reached" }], warnings: ["Retailers unavailable"], partialFailure: true });
  searchCatalog.mockResolvedValue({ offers: [{ id: "merchant-product", itemPrice: 49, imageUrl: "https://shop.example/lamp.jpg" }], facets: [], warnings: [], partialFailure: false });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  await handler({ method: "GET", query: { q: "bedside lamp", location: "Kiryat Ono, Israel", scope: "all" } }, response);
  expect(searchCatalog).toHaveBeenCalledWith("bedside lamp", "Kiryat Ono, Israel", "backup-key", undefined, expect.any(Object), "all");
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ offers: [expect.objectContaining({ id: "merchant-product" })] }));
});
