import { afterEach, describe, expect, it, vi } from "vitest";
import { extractProductData, readProductHtml } from "./product-page.mjs";
import { englishLabel, englishText, normalizeOfferFacets } from "./facet-language.mjs";
import { structuredAttributes } from "./specifications.mjs";
import { fetchJson, mapConcurrent } from "./providers.mjs";
import { isRelevantProduct, searchCatalog, shareProductSpecs } from "./search.mjs";
afterEach(() => vi.unstubAllGlobals());

describe("English-only facets from merchant pages", () => {
  it("translates Hebrew and French properties and values to the same English facet", () => {
    const data = structuredAttributes([{ name: "couleur", value: "rouge" }, { name: "צבע", value: "אדום" }, { name: "מספר לנים", value: "6 אנשים" }]);
    expect(data.attributes).toMatchObject({ color: ["Red"], capacity: ["6 people"] });
    expect(data.labels.capacity).toBe("Capacity");
  });
  it("omits undecoded or untranslated prose and supplies a readable merchant identity", () => {
    expect(englishText("טקסט לא ידוע")).toBe("");
    expect(englishText("ceci est un produit")).toBe("");
    expect(englishText("FranÃ§ais")).toBe("");
    expect(englishLabel("לא ידוע")).toBe("");
    const offer = normalizeOfferFacets({ destinationUrl: "https://www.example.co.il/product/1", attributes: { retailer: "חנות", material: "עץ מלא", ports: ["HDMI", "טקסט משובש"] } });
    expect(offer.attributes).toEqual({ retailer: "example.co.il", material: "Solid wood", ports: ["HDMI"] });
  });
});
describe("merchant product data recovery", () => {
  it("reads a currency-labelled product price from embedded application data, not the cart", () => {
    const data = extractProductData('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"cart":{"product":{"name":"Accessory","price":2,"currency":"USD"}},"product":{"name":"Camping tent","currentPrice":{"amount":349,"currencyCode":"ILS"},"image":"/tent.jpg"}}}}</script>', "https://store.example/tent");
    expect(data).toMatchObject({ title: "Camping tent", price: 349, currency: "ILS", imageUrl: "https://store.example/tent.jpg", isCatalog: false });
  });
  it("keeps the main product when a related-products ItemList is also on the page", () => {
    const data = extractProductData('<script type="application/ld+json">{"@type":"Product","name":"Main tent","offers":{"price":299,"priceCurrency":"ILS"},"image":"/tent.jpg","additionalProperty":[{"name":"Capacity","value":"6 people"}]}</script><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","name":"Tent stakes","offers":{"price":10}},{"@type":"Product","name":"Tent bag","offers":{"price":20}}]}</script>', "https://store.example/tent");
    expect(data).toMatchObject({ isCatalog: false, title: "Main tent", price: 299, imageUrl: "https://store.example/tent.jpg" });
    expect(structuredAttributes(data.specifications).attributes.capacity).toEqual(["6 people"]);
  });
  it("does not use header shipping or a struck-out price as the product price", () => {
    const data = extractProductData('<header>Shipping $10</header><main><h1>Desk lamp</h1><div class="price"><del>$100</del>$79.95</div></main>');
    expect(data.price).toBe(79.95);
  });
  it("recovers gallery images but never turns a missing image into the product page URL", () => {
    expect(extractProductData("<h1>Tent</h1>", "https://shop.example/product/tent").imageUrl).toBe("");
    const data = extractProductData('<h1>Six person tent</h1><img src="/logo.png"><img class="product-gallery" data-src="/tent.webp">', "https://shop.example/product/tent");
    expect(data.imageUrls).toEqual(["https://shop.example/tent.webp"]);
  });
  it("decodes a legacy Hebrew response using its declared charset", async () => {
    const bytes = new Uint8Array([0xe0, 0xe1, 0xe2]);
    expect(await readProductHtml({ headers: { get: () => "text/html; charset=windows-1255" }, arrayBuffer: async () => bytes.buffer })).toBe("אבג");
  });
  it("shares only non-conflicting specs for an exact product identifier, never prices or conditions", () => {
    const a = { gtin: "4006381333931", itemPrice: 100, attributes: { condition: "New", retailer: "A", ports: ["HDMI", "USB-C"] }, attributeLabels: { ports: "Ports" } };
    const b = { gtin: "4006381333931", itemPrice: 80, attributes: { condition: "Used", retailer: "B" } };
    expect(shareProductSpecs([a, b])[1]).toMatchObject({ itemPrice: 80, attributes: { ports: ["HDMI", "USB-C"], condition: "Used", retailer: "B" } });
    expect(shareProductSpecs([a, { ...b, gtin: "different" }])[1].attributes.ports).toBeUndefined();
    expect(shareProductSpecs([a, { ...a, attributes: { ports: ["VGA"] } }, b])[2].attributes.ports).toBeUndefined();
  });
});
describe("bounded source recovery", () => {
  it("does not pad camping-tent coverage with stoves or play tents", () => {
    expect(isRelevantProduct("Portable camping tent stove stainless steel", "camping tent")).toBe(false);
    expect(isRelevantProduct("אוהל משחק לילדים", "camping tent")).toBe(false);
    expect(isRelevantProduct("Camping tent with stove jack for 6 people", "camping tent")).toBe(true);
  });
  it("retries transient failures once and caches successful source responses", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "Temporarily unavailable" }) }).mockResolvedValue({ ok: true, json: async () => ({ local_results: [{ title: "Shop" }] }) });
    vi.stubGlobal("fetch", fetch);
    const url = "https://serpapi.com/search.json?engine=google_maps&q=recovery-fixture";
    expect((await fetchJson(url)).local_results).toHaveLength(1);
    await fetchJson(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not endlessly retry bad credentials or quota exhaustion", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Invalid API key" }) }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchJson("https://serpapi.com/search.json?q=credential-fixture")).rejects.toThrow("Invalid API key");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps product-page work inside its concurrency limit", async () => {
    let active = 0, maximum = 0;
    const result = await mapConcurrent(Array.from({ length: 30 }, (_, i) => i), 5, async value => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return value; });
    expect(maximum).toBe(5);
    expect(result).toHaveLength(30);
  });
  it("does not truncate 30 legitimate local retailers to the old 4-store limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => {
      const params = new URL(url).searchParams;
      const start = Number(params.get("start") ?? 0);
      return { ok: true, json: async () => params.get("engine") === "google_maps" ? { local_results: Array.from({ length: start ? 10 : 20 }, (_, i) => ({ place_id: "clock-" + (start + i), title: "Clock Store " + (start + i), type: "Clock store", website: "https://clocks-" + (start + i) + ".example/product", gps_coordinates: { latitude: 32.08, longitude: 34.78 } })) } : {} };
    }));
    const r = await searchCatalog("clock coverage fixture", "Tel Aviv, Israel", "coverage-fixture-key", { lat: 32.08, lon: 34.78 }, undefined, "local");
    expect(r.offers).toHaveLength(30);
    expect(new Set(r.offers.map(o => o.merchant)).size).toBe(30);
    expect(r.offers.every(o => o.potentialStore && o.availability.includes("confirm product stock"))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses organic new-product retailers if the shopping engine fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => {
      const request = new URL(url), engine = request.searchParams.get("engine");
      if (engine === "google_shopping") return { ok: false, status: 503, json: async () => ({ error: "Temporary shopping failure" }) };
      if (engine === "google") return { ok: true, json: async () => ({ organic_results: [{ title: "Recovery tent", link: "https://recovery.co.il/product/tent", source: "Recovery Shop" }] }) };
      return { ok: true, url, headers: { get: () => "text/html" }, text: async () => '<script type="application/ld+json">{"@type":"Product","name":"Recovery tent","image":"/tent.jpg","offers":{"price":200,"priceCurrency":"ILS"},"additionalProperty":[{"name":"Capacity","value":"6 people"}]}</script>' };
    }));
    const r = await searchCatalog("Recovery tent", "Israel", "organic-fallback-fixture", undefined, undefined, "online");
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({ category: "order", itemPrice: 200, attributes: { capacity: ["6 people"] } });
  });
  it("recovers local-pack results from Google when Maps fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => new URL(url).searchParams.get("engine") === "google_maps"
      ? { ok: false, status: 503, json: async () => ({ error: "Temporary failure" }) }
      : { ok: true, json: async () => ({ local_results: { places: [{ title: "Fallback Clock Shop", type: "Clock store", website: "https://fallback-clock.example/", gps_coordinates: { latitude: 32.08, longitude: 34.78 } }] } }) }));
    const r = await searchCatalog("clock maps fallback fixture", "Tel Aviv, Israel", "local-fallback-fixture", { lat: 32.08, lon: 34.78 }, undefined, "local");
    expect(r.offers[0].merchant).toBe("Fallback Clock Shop");
    expect(r.warnings).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
