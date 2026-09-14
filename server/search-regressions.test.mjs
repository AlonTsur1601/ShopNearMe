import { afterEach, expect, it, vi } from "vitest";
import { buildFacets, isRelevantProduct, makeResult, recoverModelSpecifications, searchCatalog } from "./search.mjs";
import { budgetFetch, withSearchBudget } from "./search-budget.mjs";
import { sameProductIdentity } from "./product-identity.mjs";

afterEach(() => vi.unstubAllGlobals());
const offer = { id: "new", category: "order", merchant: "Shop", title: "Gaming Laptop X1", itemPrice: 500, totalPrice: 500, currency: "USD", imageUrl: "https://shop.example/laptop.jpg", destinationUrl: "https://shop.example/products/x1", attributes: { memory: "16 GB" } };

it("keeps a valid new product alongside used offers despite missing specifications", () => {
  const result = makeResult("Gaming Laptop", [offer, { ...offer, id: "used", category: "secondHand", destinationUrl: "https://www.ebay.com/itm/123", attributes: { memory: "8 GB", storage: "256 GB", screenSize: "15.6 in", platform: "Windows" } }]);
  expect(result.offers.map(item => item.category)).toEqual(["order", "secondHand"]);
  expect(result.offers[0].missingAttributes).toContain("storage");
  expect(result.facets.find(facet => facet.id === "storage")).toMatchObject({ missingCount: 1, options: [{ value: "256 GB", count: 1 }] });
});
it.each([
  ["rechargeable batteries", "P2- MONITORING HEADPHONE AMPLIFIER - XLR 6.35mm with rechargeable batteries", false],
  ["rechargeable batteries", "סוללות נטענות AA", true],
  ["rechargeable batteries", "Non-rechargeable batteries", false],
  ["wireless headphones", "Wired headphones", false],
  ["Gaming Laptop 32GB", "Laptop 8GB office computer", false],
  ["Gaming Laptop 32GB", "Gaming Laptop 32GB RAM 1TB SSD", true],
])("checks product intent: %s / %s", (query, title, expected) => expect(isRelevantProduct(title, query)).toBe(expected));

it("never borrows X2 memory for X1 even when three generic words match", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ organic: [{ title: "ACME Gaming Laptop X2 32 GB RAM" }] })));
  expect(sameProductIdentity("ACME Gaming Laptop X1", "ACME Gaming Laptop X2 32 GB RAM")).toBe(false);
  const result = await recoverModelSpecifications([{ ...offer, title: "ACME Gaming Laptop X1", attributes: {} }], "Gaming Laptop", "United States", { apiKey: "wrong-model-test", zone: "test" }, ["memory"]);
  expect(result[0].attributes.memory).toBeUndefined();
});

it("searches every missing model in bounded batches instead of only the first four", async () => {
  const products = Array.from({ length: 8 }, (_, index) => ({ ...offer, id: String(index), title: `ACME Laptop M${1000 + index}`, attributes: {}, destinationUrl: `https://batch.example/${index}` }));
  const queries = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const query = new URL(JSON.parse(options.body).url).searchParams.get("q"); queries.push(query);
    return Response.json({ organic: products.filter(product => query.includes(product.title)).map(product => ({ title: product.title, description: "16 GB RAM" })) });
  }));
  const result = await recoverModelSpecifications(products, "Gaming Laptop", "United States", { apiKey: "batch-test", zone: "test" }, ["memory"]);
  expect(queries).toHaveLength(4);
  expect(result.every(product => product.attributes.memory === "16 GB")).toBe(true);
});

it("keeps successful Shopping products when shared retailer discovery is CAPTCHA blocked", async () => {
  const link = "https://independent.example/products/clock";
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url) === link) return new Response('<script type="application/ld+json">'+JSON.stringify({ "@type": "Product", name: "Digital Alarm Clock", image: "/clock.jpg", offers: { price: 25, priceCurrency: "USD" } })+'</script>', { headers: { "content-type": "text/html" } });
    const target = new URL(JSON.parse(options.body).url);
    if (target.searchParams.has("tbm")) return Response.json({ shopping: [{ title: "Digital Alarm Clock", shop: "Independent", price: "$25", url: link }, { title: "Digital Wall Clock", shop: "Group", price: "$30", url: "https://www.google.com/search?udm=28&prds=1" }] });
    return Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha" } });
  }));
  const result = await searchCatalog("Digital Clock isolation", "United States", { apiKey: "isolation-test", zone: "test" }, undefined, undefined, "online");
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0].destinationUrl).toBe(link);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings.join(" ")).toContain("CAPTCHA");
});

it("returns new marketplace offers even while Google is blocked and counts multipacks correctly", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("identity/v1")) return Response.json({ access_token: "offline-test-token", expires_in: 7200 });
    if (String(url).includes("item_summary/search")) {
      expect(new URL(url).searchParams.get("filter")).toContain("conditions:{NEW|USED}");
      return Response.json({ itemSummaries: [{ title: "DURACELL rechargeable batteries 1 PACK X4", condition: "New", conditionId: "1000", itemWebUrl: "https://www.ebay.com/itm/456", price: { value: "12", currency: "USD" }, image: { imageUrl: "https://i.ebayimg.com/batteries.jpg" } }] });
    }
    expect(String(url)).toBe("https://api.brightdata.com/request");
    expect(options.method).toBe("POST");
    return Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha" } });
  }));
  const result = await searchCatalog("rechargeable batteries", "United States", { apiKey: "new-test", zone: "test" }, undefined, { clientId: "fixture", clientSecret: "fixture" }, "online");
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0]).toMatchObject({ category: "order", itemPrice: 12, attributes: { packSize: "4 pack" } });
  expect(result.partialFailure).toBe(true);
});

it("aborts in-flight network work and prevents further requests after the search deadline", async () => {
  let aborted = false;
  vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => { aborted = true; reject(options.signal.reason); }, { once: true }))));
  await withSearchBudget(async () => {
    await expect(budgetFetch("https://slow.example")).rejects.toMatchObject({ code: "search_timeout" });
    expect(() => budgetFetch("https://never.example")).toThrow();
  }, 20);
  expect(aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains a real filter value while reporting a missing value on another product", () => {
  const facets = buildFacets([{ attributes: { color: "Black" } }, { attributes: {} }], "battery");
  expect(facets.find(facet => facet.id === "color")).toMatchObject({ missingCount: 1, options: [{ value: "Black", count: 1 }] });
});
