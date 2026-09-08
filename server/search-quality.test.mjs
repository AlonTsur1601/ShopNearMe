import { afterEach, expect, it, vi } from "vitest";
import { extractProductData, productAvailability } from "./product-page.mjs";
import { buildFacets, requireCompleteFacets, shareProductSpecs, searchCatalog } from "./search.mjs";
import { structuredAttributes } from "./specifications.mjs";

afterEach(() => vi.unstubAllGlobals());
it("detects explicit unavailable stock without inheriting related or hidden variant messages", () => {
  for (const text of ["המוצר אזל מהמלאי", "המוצר אינו במלאי", "לא קיים במלאי", "Currently unavailable", "https://schema.org/BackOrder", "Sold out"]) expect(productAvailability(text)).toBe("Out of stock");
  for (const text of ["In stock", "https://schema.org/InStock", "זמין במלאי", ""]) expect(productAvailability(text)).toBe("");
  const product = '<script type="application/ld+json">{"@type":"Product","name":"Stock test","offers":{"price":10,"availability":"https://schema.org/InStock"}}</script>';
  expect(extractProductData(product + '<main><button disabled>המוצר אזל מהמלאי</button></main>').availability).toBe("Out of stock");
  expect(extractProductData(product + '<main><button>Add to cart</button><div hidden><span class="stock">Sold out</span></div><div class="related-products"><span class="stock">Sold out</span></div></main>').availability).toBe("");
});
it("excludes unavailable listings from search results", async () => {
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (String(url).startsWith("https://serpapi.com")) return new Response(JSON.stringify({ organic_results: [{ title: "Stock fixture tent", link: "https://stock-fixture.co.il/product/tent" }] }));
    return new Response('<script type="application/ld+json">{"@type":"Product","name":"Stock fixture tent","description":"Waterproof tent with a carry bag.","offers":{"price":100,"priceCurrency":"ILS","availability":"https://schema.org/OutOfStock"}}</script>', { headers: { "content-type": "text/html" } });
  }));
  const result = await searchCatalog("Stock fixture tent", "Israel", "stock-fixture", undefined, undefined, "local-products");
  expect(result.offers).toEqual([]);
});
it("requires every product to have a non-empty value for every retained filter", () => {
  const offers = [
    { title: "One", attributes: { color: ["Black"] }, attributeLabels: { color: "Color" } },
    { title: "Two", attributes: { color: "White" }, attributeLabels: { color: "Color" } },
    { title: "Missing", attributes: { color: [] }, attributeLabels: { color: "Color" } },
    { title: "Nearby store", potentialStore: true, attributes: { retailer: "Local" } },
  ];
  const complete = requireCompleteFacets(offers, "headphones");
  expect(complete.map(offer => offer.title)).toEqual(["One", "Two", "Nearby store"]);
  expect(buildFacets(complete, "headphones").find(facet => facet.id === "color")?.options).toEqual([{ value: "Black", count: 1 }, { value: "White", count: 1 }]);
  expect(complete.filter(offer => !offer.potentialStore).every(offer => String(offer.attributes.color).trim())).toBe(true);
});
it("shares deterministic source facets, accepts equivalent value shapes and isolates variants", () => {
  const donor = { title: "MSI MAG A650BN", productBrand: "MSI", attributes: { power: ["650 W"], "spec:fan_diameter": ["120 mm"] }, attributeLabels: { power: "Power", "spec:fan_diameter": "Fan diameter" } };
  const receiver = { title: "ספק MSI MAG A650BN 650W", attributes: { power: "650 W" } };
  const result = shareProductSpecs([donor, receiver]);
  expect(result[1].attributes["spec:fan_diameter"]).toEqual(["120 mm"]);
  expect(buildFacets(result, "power supply")).toContainEqual(expect.objectContaining({ id: "spec:fan_diameter", options: [{ value: "120 mm", count: 2 }] }));
  expect(shareProductSpecs([donor, { ...receiver, title: "MSI MAG A850GL" }])[1].attributes["spec:fan_diameter"]).toBeUndefined();
  const variants = shareProductSpecs([{ ...donor, attributes: { ...donor.attributes, color: "Black" } }, { ...receiver, attributes: { color: "White" } }]);
  expect(variants[1].attributes["spec:fan_diameter"]).toBeUndefined();
});

it("rejects marketplace bookkeeping fields from product facets", () => {
  const { attributes } = structuredAttributes([
    { name: "Serial Number", value: "ABC123" },
    { name: "eBay Condition", value: "3000" },
    { name: "Stok Total", value: "99" },
    { name: "JAN", value: "4526541038785" },
    { name: "Fan diameter", value: "120 mm" },
  ], { allowEnglish: true });
  expect(attributes).toEqual({ "spec:fan_diameter": ["120 mm"] });
});
