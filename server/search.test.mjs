import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFacets, isRelevantProduct, providerLocation, safeHttpUrl, searchCatalog, shortRetailerName } from "./search.mjs";
import { extractProductData } from "./product-page.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("safeHttpUrl", () => {
  it("allows web links and rejects unsafe or malformed schemes", () => {
    expect(safeHttpUrl("https://shop.example/item?id=1")).toBe("https://shop.example/item?id=1");
    expect(safeHttpUrl("http://shop.example/item")).toBe("http://shop.example/item");
    expect(safeHttpUrl("javascript:alert(1)", "https://www.google.com/shopping")).toBe("https://www.google.com/shopping");
    expect(safeHttpUrl("data:text/html,unsafe", "")).toBe("");
    expect(safeHttpUrl("not a url", "https://fallback.example/")).toBe("https://fallback.example/");
    expect(safeHttpUrl("https://shop.example/item?id\\u003d1\\u0026color\\u003dblack")).toBe("https://shop.example/item?id=1&color=black");
  });
});

describe("product page enrichment", () => {
  it("extracts the actual product image, price, currency, and brand from JSON-LD", () => {
    const data = extractProductData(`<script type="application/ld+json">{"@type":"Product","name":"Oak dining table","brand":{"name":"Furni"},"image":"https://shop.example/table.jpg","offers":{"@type":"Offer","price":"1299","priceCurrency":"ILS"}}</script>`);
    expect(data).toMatchObject({ title: "Oak dining table", brand: "Furni", imageUrl: "https://shop.example/table.jpg", price: 1299, currency: "ILS" });
  });

  it("extracts localized visible prices and relative product images without JSON-LD", () => {
    const data = extractProductData(`<meta property="og:title" content="MSI MAG A750GL PSU"><meta property="og:image" content="/media/psu.jpg"><meta itemprop="priceCurrency" content="ILS"><span class="price">1.299,00 ₪</span>`, "https://shop.example/products/psu");
    expect(data).toMatchObject({ title: "MSI MAG A750GL PSU", imageUrl: "https://shop.example/media/psu.jpg", price: 1299, currency: "ILS" });
  });
});

describe("searchCatalog", () => {
  it("normalizes reverse-geocoded addresses and retries rejected provider locations", async () => {
    const address = "HaSadna Street, Petah Tikva, Petah Tikva Subdistrict, Center District, Israel";
    expect(providerLocation(address)).toBe("Petah Tikva, Israel");
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.has("location")) return { ok: false, status: 400, json: async () => ({ error: "Unsupported location - location parameter" }) };
      return { ok: true, json: async () => ({ shopping_results: [{ title: "מסך OLED QHD 240Hz", source: "Monitor Store", extracted_price: 1500, price: "1500 ₪", link: "https://screen.example/oled", thumbnail: "https://screen.example/oled.jpg" }] }) };
    }));
    const result = await searchCatalog("OLED 1440p monitor retry", address, "test", undefined, undefined, "online");
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].category).toBe("order");
    expect(result.warnings).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => new URL(url).hostname === "serpapi.com")).toHaveLength(2);
    expect(new URL(vi.mocked(fetch).mock.calls[1][0]).searchParams.get("gl")).toBe("il");
  });

  it("resolves retailer links, shipping and monitor facets from product groups", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.get("engine") === "google_shopping") return { ok: true, json: async () => ({ shopping_results: [{ title: "OLED monitor", product_id: "screen", product_link: "https://google.com/search?q=screen", immersive_product_page_token: "fixture", thumbnail: "https://img.example/screen.jpg" }] }) };
      return { ok: true, json: async () => ({ product_results: { stores: [
        { name: "Screen One", title: '27 inch QD-OLED QHD monitor 240Hz 0.03ms', link: "https://screen.example/product/a", price: "1500 ₪", extracted_price: 1500, shipping_extracted: 40 },
        { name: "Screen Two", title: '32 inch WOLED 1440p monitor 360Hz 0.02ms', link: "https://screen.example/product/b", price: "2000 ₪", extracted_price: 2000, shipping: "Free" },
      ] } }) };
    }));
    const result = await searchCatalog("OLED monitor grouped", "Israel", "test", undefined, undefined, "online");
    expect(result.offers.map(o => o.totalPrice)).toEqual([1540, 2000]);
    expect(result.offers.every(o => new URL(o.destinationUrl).hostname === "screen.example")).toBe(true);
    expect(result.facets.map(f => f.id)).toEqual(expect.arrayContaining(["screenSize", "displayType", "refreshRate", "responseTime"]));
    expect(isRelevantProduct("מסך IPS 1080p", "OLED 1440p monitor")).toBe(false);
    expect(isRelevantProduct("מסך QD-OLED QHD", "OLED 1440p monitor")).toBe(true);
  });

  it("does not cache incomplete provider results as a successful full search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "Temporarily unavailable" }) })));
    const first = await searchCatalog("provider failure boundary", "Israel", "test", undefined, undefined, "online");
    const second = await searchCatalog("provider failure boundary", "Israel", "test", undefined, undefined, "online");
    expect(first.warnings).toEqual(["Online stores could not be searched. Please try again."]);
    expect(second.warnings).toEqual(first.warnings);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads structured specifications but identifies category pages", () => {
    const data = extractProductData('<script type="application/ld+json">{"@type":"Product","name":"Monitor","description":"OLED QHD","additionalProperty":[{"name":"Refresh rate","value":240,"unitText":"Hz"}]}</script>');
    expect(data.specificationText).toContain("240 Hz");
    expect(data.isCatalog).toBe(false);
    expect(extractProductData('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]}</script>').isCatalog).toBe(true);
  });

  it("hides sparse guessed facets that cannot provide a real choice", () => {
    const offers = Array.from({ length: 8 }, (_, index) => ({ attributes: index === 0 ? { material: "Wood" } : {} }));
    expect(buildFacets(offers, "generic product").some((facet) => facet.id === "material")).toBe(false);
  });

  it("merges nearby Google Maps stores with shopping offers using the selected coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.get("engine") === "google_maps") return { ok: true, json: async () => ({ local_results: [
        { position: 1, title: "Clock Corner", address: "1 Main Street", type: "Clock shop", rating: 4.7, reviews: 52, thumbnail: "https://images.example/store.jpg", website: "https://clock.example/", gps_coordinates: { latitude: 32.081, longitude: 34.781 } },
        { position: 2, title: "PC Doctor", address: "2 Main Street", type: "Computer repair service", rating: 4.9, reviews: 200, gps_coordinates: { latitude: 32.082, longitude: 34.782 } },
        { position: 3, title: "Remote Clock Shop", address: "Far away", type: "Clock shop", rating: 5, reviews: 100, gps_coordinates: { latitude: 40.7128, longitude: -74.006 } },
        { position: 4, title: "Corner Cafe", address: "3 Main Street", type: "Coffee shop", rating: 4.8, reviews: 300, gps_coordinates: { latitude: 32.083, longitude: 34.783 } },
      ] }) };
      return { ok: true, json: async () => ({ shopping_results: [{ position: 1, title: "Silent wall clock", source: "Online Shop", extracted_price: 29.99, delivery: "Free shipping", product_link: "https://online.example/clock", thumbnail: "https://images.example/clock.jpg" }] }) };
    }));
    const result = await searchCatalog("clock test local merge", "Tel Aviv", "test-key", { lat: 32.08, lon: 34.78 });
    expect(result.offers.some((offer) => offer.category === "local" && offer.merchant === "Clock Corner")).toBe(true);
    expect(result.offers.some((offer) => offer.merchant === "PC Doctor")).toBe(false);
    expect(result.offers.some((offer) => offer.merchant === "Remote Clock Shop")).toBe(false);
    expect(result.offers.some((offer) => offer.merchant === "Corner Cafe")).toBe(false);
    expect(result.offers.some((offer) => offer.category === "order")).toBe(true);
    expect(result.offers[0].category).toBe("local");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => new URL(url).hostname === "serpapi.com")).toHaveLength(3);
    expect(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("engine=google_maps"))?.[0])).toContain("q=clock+stores+near+Tel+Aviv");
    expect(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("engine=google_maps"))?.[0])).toContain("ll=%4032.08%2C34.78%2C14z");
  });

  it("builds useful dining-table facets and concise retailer names", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.get("engine") === "google_shopping") return { ok: true, json: async () => ({ shopping_results: [
        { position: 1, title: "72 inch solid wood extendable dining table for 8 people", source: "SIHOO ישראל אתר היבואן הרשמי", extracted_price: 800, delivery: "Free shipping", product_link: "https://sihoo.example/products/table-8" },
        { position: 2, title: "Round glass dining table with 4 chairs", source: "SIHOO ישראל אתר היבואן הרשמי", extracted_price: 650, delivery: "Free shipping", product_link: "https://sihoo.example/products/table-4" },
        { position: 3, title: "60 inch rectangular wood fixed dining table, table only", source: "Home Store - Official Site", extracted_price: 500, delivery: "Free shipping", product_link: "https://home.example/products/table" },
      ] }) };
      return { ok: true, json: async () => ({}) };
    }));
    const result = await searchCatalog("dining table facet coverage", "Tel Aviv, Israel", "facet-key", undefined, undefined, "online");
    const facetIds = result.facets.map((facet) => facet.id);
    expect(facetIds).toEqual(expect.arrayContaining(["tableSize", "material", "chairsIncluded", "extendable", "retailer"]));
    expect(facetIds).not.toContain("style");
    expect(result.facets.find((facet) => facet.id === "retailer")?.options.map(({ value }) => value)).toContain("SIHOO");
    expect(shortRetailerName("SIHOO ישראל אתר היבואן הרשמי")).toBe("SIHOO");
  });

  it("builds useful PSU facets from real offer specifications", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.get("engine") === "google_shopping") return { ok: true, json: async () => ({ shopping_results: [
        { position: 1, title: "MSI MAG A750GL PSU 750W 80 Plus Gold Fully Modular ATX PCIe 5.0", source: "PC One", extracted_price: 499, delivery: "Free shipping", product_link: "https://pc-one.example/psu750", thumbnail: "https://img.example/750.jpg" },
        { position: 2, title: "Corsair PSU 1000W 80 Plus Platinum Semi Modular ATX PCIe 4.0", source: "PC Two", extracted_price: 799, delivery: "Free shipping", product_link: "https://pc-two.example/psu1000", thumbnail: "https://img.example/1000.jpg" },
      ] }) };
      return { ok: true, json: async () => ({}) };
    }));
    const result = await searchCatalog("PSU", "Tel Aviv, Israel", "facet-key", undefined, undefined, "online");
    expect(result.facets.map(({ id }) => id)).toEqual(expect.arrayContaining(["wattage", "efficiency", "modularity", "pcie", "retailer"]));
  });

  it("merges a nearby store with its actual local product page price, image, distance, and facets", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.hostname === "local-pc.co.il") return { ok: true, url: request.href, headers: { get: () => "text/html" }, text: async () => `<script type="application/ld+json">{"@type":"Product","name":"MSI MAG A750GL PSU 750W 80 Plus Gold Fully Modular","image":"/psu.jpg","additionalProperty":[{"name":"Protection circuits","value":["Overvoltage","Overcurrent"]}],"offers":{"price":"529"}}</script>` };
      if (request.searchParams.get("engine") === "google_maps") return { ok: true, json: async () => ({ local_results: [{ title: "Local PC", type: "Computer store", website: "https://local-pc.co.il", gps_coordinates: { latitude: 32.081, longitude: 34.781 } }] }) };
      if (request.searchParams.get("engine") === "google") return { ok: true, json: async () => ({ organic_results: [{ title: "MSI MAG A750GL PSU 750W 80 Plus Gold Fully Modular", link: "https://local-pc.co.il/products/a750gl", source: "Local PC", snippet: "750W 80 Plus Gold fully modular power supply — 529 ₪" }] }) };
      return { ok: true, json: async () => ({ shopping_results: [] }) };
    }));
    const result = await searchCatalog("MSI MAG PSU", "Tel Aviv, Israel", "local-product-key", { lat: 32.08, lon: 34.78 });
    const offer = result.offers.find(({ merchant }) => merchant === "Local PC");
    expect(offer).toMatchObject({ category: "local", itemPrice: 529, currency: "ILS", imageUrl: "https://local-pc.co.il/psu.jpg", linkLabel: "View product" });
    expect(offer.distanceMiles).toBeGreaterThan(0);
    expect(offer.attributes).toMatchObject({ wattage: "700–899 W", efficiency: "80 Plus Gold", modularity: "Fully modular" });
    expect(offer.attributes["spec:protection_circuits"]).toEqual(["Overvoltage", "Overcurrent"]);
    expect(result.facets.find(facet => facet.id === "spec:protection_circuits")?.options).toEqual([{ value: "Overvoltage", count: 1 }, { value: "Overcurrent", count: 1 }]);
  });

  it("coalesces identical in-flight scoped searches", async () => {
    let release;
    const fetchMock = vi.fn(() => new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => ({ shopping_results: [] }) }); }));
    vi.stubGlobal("fetch", fetchMock);
    const first = searchCatalog("coalescing boundary product", "Haifa, Israel", "coalesce-key", undefined, undefined, "online");
    const second = searchCatalog("coalescing boundary product", "Haifa, Israel", "coalesce-key", undefined, undefined, "online");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
  });

  it("adds eBay item details, specifications, shipping and import charges to the total", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.hostname === "api.ebay.com" && request.pathname.includes("oauth2/token")) {
        return { ok: true, json: async () => ({ access_token: "test-token", expires_in: 7200 }) };
      }
      if (request.hostname === "api.ebay.com" && request.pathname.includes("/item/")) return { ok: true, json: async () => ({
        localizedAspects: [{ name: "Power source", value: "Battery" }],
        shippingOptions: [{ shippingCost: { value: "6.50", currency: "USD" }, importCharges: { value: "3.20", currency: "USD" } }],
      }) };
      if (request.hostname === "api.ebay.com") {
        return { ok: true, json: async () => ({ itemSummaries: [{
          itemId: "v1|123|0", title: "Used oak desk clock", condition: "Pre-Owned", itemWebUrl: "https://www.ebay.com/itm/123",
          image: { imageUrl: "https://i.ebayimg.com/images/clock.jpg" }, price: { value: "88.80", currency: "ILS", convertedFromValue: "24.00", convertedFromCurrency: "USD" },
          shippingOptions: [{ shippingCost: { value: "24.05", currency: "ILS", convertedFromValue: "6.50", convertedFromCurrency: "USD" } }], seller: { username: "time-seller", feedbackPercentage: "99.8", feedbackScore: 420 },
        }] }) };
      }
      if (request.searchParams.get("engine") === "google_maps") return { ok: true, json: async () => ({ local_results: [] }) };
      return { ok: true, json: async () => ({ shopping_results: [] }) };
    }));
    const result = await searchCatalog("ebay integration clock", "Tel Aviv, Israel", "test-key", { lat: 32.08, lon: 34.78 }, { clientId: "client", clientSecret: "secret" });
    const offer = result.offers.find((item) => item.id === "ebay-v1|123|0");
    expect(offer).toMatchObject({ category: "secondHand", merchant: "eBay", itemPrice: 24, shippingPrice: 6.5, importTaxPrice: 3.2, totalPrice: 33.7, priceVerified: true, attributes: { "spec:power_source": ["Battery"] } });
    const ebayCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("item_summary/search"));
    expect(String(ebayCall?.[0])).toContain("conditions%3A%7BUSED%7D%2CdeliveryCountry%3AIL");
  });
});
