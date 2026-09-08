import { afterEach, expect, it, vi } from "vitest";
import { enrichProductPage, extractProductData } from "./product-page.mjs";
import { isCategoryPage, recoverModelSpecifications, searchCatalog, shareProductSpecs } from "./search.mjs";
import { proseAttributes, structuredAttributes } from "./specifications.mjs";
import { normalizeOfferFacets } from "./facet-language.mjs";

afterEach(() => vi.unstubAllGlobals());

it("rejects store search URLs but preserves product identity and tracking parameters", () => {
  for (const path of ["/search?q=lamp", "/?s=lamp&post_type=product", "/catalogsearch/result/?q=lamp", "/search.aspx?keyword=lamp", "/?route=product/search", "/חיפוש/lamp"]) expect(isCategoryPage("Desk lamp", "https://store.example" + path)).toBe(true);
  expect(isCategoryPage("Desk lamp", "https://store.example/catalog.php?id=123&srsltid=tracking")).toBe(false);
});

it("rejects a deleted product that redirects to store search results", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, url: "https://redirect.example/search?q=lamp", headers: { get: () => "text/html" }, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Lamp","offers":{"price":99}}</script>' })));
  expect(await enrichProductPage("https://redirect.example/old-lamp")).toEqual({ isCatalog: true });
});

it("rejects product-tag pages and preserves decimal power and canonical colors", () => {
  expect(isCategoryPage("מטען GaN 65W", "https://mobilestyleono.co.il/product-tag/charger/")).toBe(true);
  expect(isCategoryPage("מטען", "https://mobilestyleono.co.il/product/charger/")).toBe(false);
  expect(proseAttributes("Baseus 22.5W 20000mAh").attributes.power).toEqual(["22.5 W"]);
  expect(normalizeOfferFacets({ attributes: { color: ["White", "white", "grey"] } }).attributes.color).toEqual(["White", "Gray"]);
});

it("recovers missing facets from an exact manufacturer part without copying donor prices", async () => {
  const offers = [
    { mpn: "ABC-123", productBrand: "Maker", title: "Desk lamp", itemPrice: 80, attributes: {}, destinationUrl: "https://receiver.example/lamp" },
    { title: "Other lamp", attributes: { color: "White" }, destinationUrl: "https://other.example/lamp" },
  ];
  vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("api.brightdata.com")
    ? new Response(JSON.stringify({ organic: [{ title: "Maker ABC-123", link: "https://maker.example/ABC-123" }] }))
    : new Response('<script type="application/ld+json">{"@type":"Product","name":"Desk lamp","mpn":"ABC-123","brand":"Maker","color":"Black","offers":{"price":900}}</script>', { headers: { "Content-Type": "text/html" } })));
  const result = await recoverModelSpecifications(offers, "desk lamp", "Israel", { apiKey: "spec-fixture", zone: "zone" });
  expect(result[0]).toMatchObject({ itemPrice: 80, attributes: { color: ["Black"] } });
  expect(result).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([404, 410])("marks HTTP %s product pages unavailable", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Gone", { status })));
  expect(await enrichProductPage(`https://merchant.example/gone-${status}`)).toEqual({ unavailable: true });
});

it("rejects soft-404 pages", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<title>Product not found</title><h1>404</h1>", { headers: { "Content-Type": "text/html" } })));
  expect(await enrichProductPage("https://merchant.example/soft-404")).toEqual({ unavailable: true });
});

it("does not resurrect a deleted product from an indexed price", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (new URL(url).hostname === "deleted.co.il") return new Response("Gone", { status: 410 });
    return new Response(JSON.stringify({ organic_results: [{ title: "Deleted desk lamp", link: "https://deleted.co.il/product/lamp", snippet: "Deleted desk lamp 99 ILS" }] }));
  }));
  const result = await searchCatalog("Deleted desk lamp", "Israel", "deleted-fixture", undefined, undefined, "local-products");
  expect(result.offers).toEqual([]);
});

it("suppresses a source failure warning when another source supplies online offers, but keeps failure state", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => {
    const target = new URL(url);
    if (target.hostname === "working.co.il") return new Response('<script type="application/ld+json">{"@type":"Product","name":"Working desk lamp","offers":{"price":99,"priceCurrency":"ILS"},"image":"/lamp.jpg"}</script>', { headers: { "Content-Type": "text/html" } });
    if (target.searchParams.get("engine") === "google_shopping") return new Response("", { status: 503 });
    return new Response(JSON.stringify({ organic_results: [{ title: "Working desk lamp", link: "https://working.co.il/product/lamp" }] }));
  }));
  const result = await searchCatalog("Working desk lamp", "Israel", "working-fixture", undefined, undefined, "online");
  expect(result.offers).toHaveLength(1);
  expect(result.warnings).toEqual([]);
  expect(result.partialFailure).toBe(true);
  const before = vi.mocked(fetch).mock.calls.length;
  await searchCatalog("Working desk lamp", "Israel", "working-fixture", undefined, undefined, "online");
  expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before);
});

it("extracts named description and div-row properties regardless of product category", () => {
  const page = extractProductData('<main><div class="product-description">Color: Black<br>Material: Steel<br>Width: 120 cm<br>Chairs included: No</div><div class="spec-row"><span>Capacity</span><span>6 people</span></div><div class="related-products"><div class="spec-row"><span>Color</span><span>Red</span></div></div></main>');
  const attrs = structuredAttributes(page.specifications).attributes;
  expect(attrs).toMatchObject({ color: ["Black"], material: ["Steel"], width: ["120 cm"], chairsIncluded: ["No"], capacity: ["6 people"] });
});

it("shares manufacturer-part specifications across merchants, not different parts or makers", () => {
  const donor = { mpn: "ABC-123", productBrand: "Maker", attributes: { color: ["Black"], power: ["30 W"] }, itemPrice: 100 };
  const receiver = { mpn: "abc-123", productBrand: "maker", attributes: {}, itemPrice: 80 };
  expect(shareProductSpecs([donor, receiver])[1]).toMatchObject({ attributes: donor.attributes, itemPrice: 80 });
  for (const changed of [{ mpn: "ABC-124" }, { productBrand: "Other" }, { mpn: "" }]) expect(shareProductSpecs([donor, { ...receiver, ...changed }])[1].attributes).toEqual({});
  expect(shareProductSpecs([{ ...donor, mpn: "138003" }, { ...receiver, mpn: "138003" }])[1].attributes).toEqual({});
});

it("recovers a failed Maps query using a related store type and preserves coordinates", async () => {
  const mapQueries = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).startsWith("https://recovered.co.il/")) return new Response('<script type="application/ld+json">{"@type":"Product","name":"USB-C charger","image":"/charger.jpg","offers":{"price":49,"priceCurrency":"ILS"}}</script>', { headers: { "Content-Type": "text/html" } });
    const target = new URL(JSON.parse(init.body).url);
    if (target.pathname.startsWith("/maps/")) {
      mapQueries.push(decodeURIComponent(target.pathname));
      if (decodeURIComponent(target.pathname).includes("cell phone")) return new Response("", { status: 503 });
      return new Response(JSON.stringify({ organic: [{ title: "Recovered", link: "https://recovered.co.il/", category: [{ id: "electronics_store" }], latitude: 32.062, longitude: 34.855 }] }));
    }
    return new Response(JSON.stringify({ organic: [{ title: "USB-C charger", link: "https://recovered.co.il/product/charger" }] }));
  }));
  const result = await searchCatalog("USB-C charger", "Kiryat Ono, Israel", { apiKey: "maps-recovery-fixture", zone: "zone" }, { lat: 32.062, lon: 34.855 });
  expect(mapQueries.some(query => query.includes("electronics stores") && query.includes("@32.062,34.855"))).toBe(true);
  expect(result.offers.find(offer => offer.category === "local")).toMatchObject({ destinationUrl: "https://recovered.co.il/product/charger", itemPrice: 49, imageUrl: "https://recovered.co.il/charger.jpg" });
  expect(result.warnings).toEqual([]);
});
