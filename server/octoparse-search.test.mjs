import { afterEach, expect, it, vi } from "vitest";
import { discoverOctoparseCatalog } from "./octoparse-catalog.mjs";
import { geocodingAddress, searchRetailCatalog } from "./search.mjs";
import { searchContext } from "./search-budget.mjs";

vi.mock("./octoparse-catalog.mjs", () => ({ discoverOctoparseCatalog: vi.fn(), persistOctoparseLocations: value => value.continuation }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cleans branch labels and country codes without dropping the street number or city", () => {
  expect(geocodingAddress("רח' לישנסקי 3, סניף ראשון לציון, IL")).toBe("לישנסקי 3, ראשון לציון, Israel");
});

it("geocodes a branch even when product retrieval has exhausted its deadline", async () => {
  vi.useFakeTimers();
  let discoverySignal;
  vi.mocked(discoverOctoparseCatalog).mockImplementationOnce(async () => {
    discoverySignal = searchContext().signal;
    await new Promise(resolve => setTimeout(resolve, 12001));
    return { products: [record([{ address: "Recovery Street 17", name: "City" }])], places: [], sourceStatus: [] };
  });
  const fetcher = vi.fn(async () => Response.json([{ lat: "32.062", lon: "34.855", addresstype: "house" }]));
  vi.stubGlobal("fetch", fetcher);
  const job = searchRetailCatalog("deadline table lamp", "City", { provider: "octoparse", octoparseApiKey: "deadline-key" }, { lat: 32.062, lon: 34.855 });
  await vi.advanceTimersByTimeAsync(13000);
  const result = await job;
  expect(discoverySignal.aborted).toBe(true);
  expect(result.offers.some(offer => offer.category === "local")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

const record = (locations = []) => ({ id: "source-product", link: "https://merchant.example/products/lamp", title: "Studio table lamp", page: {
  title: "Studio table lamp", imageUrl: "https://merchant.example/lamp.jpg", price: 199, currency: "ILS", locations,
  specifications: [{ name: "Color", value: "White" }, { name: "Material", value: "Metal" }],
} });

it("returns a real nearby product before another source finishes and resolves branches beyond the first four", async () => {
  const locations = Array.from({ length: 6 }, (_, i) => ({ address: `Branch ${i}`, name: "City" }));
  vi.mocked(discoverOctoparseCatalog).mockResolvedValueOnce({ products: [record(locations)], places: [], continuation: "signed-continuation", nextPollAt: Date.now() + 15000, sourceStatus: [{ source: "Nearby branches via Octoparse", status: "pending" }] });
  const fetcher = vi.fn(async value => {
    const link = new URL(value);
    if (link.hostname !== "nominatim.openstreetmap.org") throw new Error("Unexpected provider");
    return Response.json([{ lat: link.searchParams.get("q").startsWith("5,") ? "32.062" : "31.0", lon: "34.855", addresstype: "house" }]);
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await searchRetailCatalog("table lamp", "Kiryat Ono, Israel", { provider: "octoparse", octoparseApiKey: "fixture-key" }, { lat: 32.062, lon: 34.855 });
  const nearby = result.offers.find(offer => offer.category === "local");
  expect(nearby).toMatchObject({ destinationUrl: record().link, itemPrice: 199, imageUrl: record().page.imageUrl, subtitle: "Branch 5", attributes: { color: ["White"], material: ["Metal"] } });
  expect(nearby.distanceMiles).toBe(0);
  expect(result.pendingSearch.continuation).toBe("signed-continuation");
  expect(fetcher).toHaveBeenCalledTimes(6);
}, 10000);

it("matches a located branch without a website by exact merchant name without showing a directory row", async () => {
  vi.mocked(discoverOctoparseCatalog).mockResolvedValueOnce({ products: [record()], places: [{ title: "merchant.example", website: "", address: "City", place_id: "source-place", gps_coordinates: { latitude: 32.062, longitude: 34.855 } }], sourceStatus: [] });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request"); }));
  const result = await searchRetailCatalog("table lamp", "Kiryat Ono, Israel", { provider: "octoparse", octoparseApiKey: "fixture-key" }, { lat: 32.062, lon: 34.855 });
  expect(result.offers.filter(offer => offer.category === "local")).toHaveLength(1);
  expect(result.offers.every(offer => offer.destinationUrl === record().link && offer.itemPrice === 199 && offer.imageUrl === record().page.imageUrl)).toBe(true);
});

it("classifies actual product condition rather than merchant or incidental title words", async () => {
  for (const [title, condition, category] of [["Vintage style table lamp", "Brand new", "order"], ["Table lamp with diffused light", undefined, "order"], ["Studio table lamp", "Pre-owned", "secondHand"]]) {
    const item = record(); item.title = title; item.page.title = title; item.page.condition = condition;
    vi.mocked(discoverOctoparseCatalog).mockResolvedValueOnce({ products: [item], places: [], sourceStatus: [] });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected external request"); }));
    const result = await searchRetailCatalog("table lamp", "Israel", { provider: "octoparse", octoparseApiKey: "condition-test" }, undefined, undefined, "online");
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].category).toBe(category);
  }
});
