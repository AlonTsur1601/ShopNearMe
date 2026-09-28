import { afterEach, expect, it, vi } from "vitest";
import { enrichProductPage } from "./product-page.mjs";
import { publicProduct, magentoProduct } from "./public-product.mjs";
import { structuredAttributes } from "./specifications.mjs";
import { recoverModelSpecifications, shareProductSpecs } from "./search.mjs";
import { searchRetailerSites } from "./retailer-sites.mjs";
afterEach(() => vi.unstubAllGlobals());
const product = { title: "Camping tent", handle: "tent", vendor: "Maker", description: '<table><tr><th>Capacity</th><td>6 people</td></tr></table>', options: [{ name: "Color" }], featured_image: "/tent.jpg", variants: [{ id: 1, title: "Blue", options: ["Blue"], price: 12000, available: true, barcode: "4006381333931" }, { id: 2, title: "Red", options: ["Red"], price: 25000, available: false }] };
it("recovers a blocked product through its public API with the exact variant, currency, and real specifications", async () => {
  const fetch = vi.fn(async value => String(value).endsWith("tent.js") ? Response.json(product) : String(value).endsWith("cart.js") ? Response.json({ currency: "ILS" }) : new Response("Access denied", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const page = await enrichProductPage("https://shopify-fixture.example/en/collections/camping/products/tent?variant=2");
  expect(page).toMatchObject({ title: "Camping tent — Red", price: 250, currency: "ILS", availability: "Out of stock", imageUrl: "https://shopify-fixture.example/tent.jpg" });
  expect(structuredAttributes(page.specifications).attributes).toMatchObject({ color: ["Red"], capacity: ["6 people"] });
  expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(["https://shopify-fixture.example/en/collections/camping/products/tent?variant=2", "https://shopify-fixture.example/en/products/tent.js", "https://shopify-fixture.example/en/cart.js"]);
});
it("does not borrow an arbitrary variant price or options for an unselected multi-variant product", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(product)));
  const data = await publicProduct("https://multi.example/products/tent", "", AbortSignal.timeout(1000));
  expect(data.offers).toEqual({});
  expect(data.additionalProperty).toEqual([]);
  expect(await publicProduct("https://multi.example/products/tent?variant=99", "", AbortSignal.timeout(1000))).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("never resurrects an explicitly deleted product through a fallback", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 410 })));
  expect(await enrichProductPage("https://deleted-shopify.example/products/tent")).toEqual({ unavailable: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not treat a configurable Magento family's minimum price as a selected variant", () => {
  const item = { __typename: "ConfigurableProduct", name: "Tent", price_range: { minimum_price: { final_price: { value: 10, currency: "ILS" } }, maximum_price: { final_price: { value: 10, currency: "ILS" } } } };
  expect(magentoProduct(item, "https://store.example/tent").offers.price).toBeUndefined();
});
it("recovers current catalog products with source prices and ignores unrelated and sold-out products", async () => {
  const item = { __typename: "SimpleProduct", name: "Camping tent", url_key: "camping-tent", image: { url: "https://store.example/tent.jpg" }, description: { html: product.description }, stock_status: "IN_STOCK", price_range: { minimum_price: { final_price: { value: 299, currency: "ILS" } }, maximum_price: { final_price: { value: 299, currency: "ILS" } } } };
  const fetchPage = vi.fn(async value => String(value).includes("/graphql?") ? Response.json({ data: { products: { items: [item, { ...item, name: "Tent stakes" }, { ...item, stock_status: "OUT_OF_STOCK" }] } } }) : new Response("", { status: 403 }));
  const result = await searchRetailerSites({ query: "camping tent", country: "IL", relevant: title => title === "Camping tent", isCatalog: () => false, deadline: Date.now() + 1000 }, { fetchPage });
  expect(result.products).toHaveLength(1);
  expect(result.products[0]).toMatchObject({ link: "https://www.officedepot.co.il/camping-tent", page: { price: 299, currency: "ILS" } });
  expect(structuredAttributes(result.products[0].page.specifications).attributes.capacity).toEqual(["6 people"]);
});
it("shares verified properties between local and online offers of the same URL, fills empty values and keeps variants separate", () => {
  const base = { gtin: "4006381333931", destinationUrl: "https://store.example/tent?variant=1", attributes: { color: "Blue", capacity: "6 people" } };
  const target = { ...base, gtin: "", attributes: { capacity: [] }, category: "local" };
  const other = { ...target, destinationUrl: "https://store.example/tent?variant=2" };
  const result = shareProductSpecs([base, target, other]);
  expect(result[1].attributes).toEqual(base.attributes);
  expect(result[2].attributes).toEqual({ capacity: [] });
});
it("ignores a placeholder GTIN when matching an exact manufacturer's part", async () => {
  vi.stubGlobal("fetch", vi.fn(async value => String(value).includes("api.brightdata.com") ? Response.json({ organic: [{ title: "Maker TENT-100", link: "https://maker-gtin.example/TENT-100" }] }) : new Response('<script type="application/ld+json">{"@type":"Product","name":"Camping tent","mpn":"TENT-100","brand":"Maker","gtin":"4006381333931","additionalProperty":[{"name":"Capacity","value":"6 people"}]}</script>', { headers: { "Content-Type": "text/html" } })));
  const result = await recoverModelSpecifications([{ title: "Camping tent", gtin: "Does not apply", mpn: "TENT-100", productBrand: "Maker", attributes: {} }], "camping tent", "Israel", { apiKey: "placeholder-gtin-fixture", zone: "test" }, ["capacity"]);
  expect(result[0].attributes.capacity).toEqual(["6 people"]);
});
