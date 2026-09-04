import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFacets, safeHttpUrl, searchCatalog, shortRetailerName } from "./search.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("safeHttpUrl", () => {
  it("allows web links and rejects unsafe or malformed schemes", () => {
    expect(safeHttpUrl("https://shop.example/item?id=1")).toBe("https://shop.example/item?id=1");
    expect(safeHttpUrl("http://shop.example/item")).toBe("http://shop.example/item");
    expect(safeHttpUrl("javascript:alert(1)", "https://www.google.com/shopping")).toBe("https://www.google.com/shopping");
    expect(safeHttpUrl("data:text/html,unsafe", "")).toBe("");
    expect(safeHttpUrl("not a url", "https://fallback.example/")).toBe("https://fallback.example/");
  });
});

describe("searchCatalog", () => {
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
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("engine=google_maps"))?.[0])).toContain("q=where+to+buy+clock+test+local+merge");
    expect(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("engine=google_maps"))?.[0])).toContain("ll=%4032.08%2C34.78%2C14z");
  });

  it("builds useful dining-table facets and concise retailer names", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.searchParams.get("engine") === "google_shopping") return { ok: true, json: async () => ({ shopping_results: [
        { position: 1, title: "72 inch solid wood extendable dining table for 8 people", source: "SIHOO ישראל אתר היבואן הרשמי", extracted_price: 800, delivery: "Free shipping", product_link: "https://sihoo.example/products/table-8" },
        { position: 2, title: "Round glass dining table with 4 chairs", source: "SIHOO ישראל אתר היבואן הרשמי", extracted_price: 650, delivery: "Free shipping", product_link: "https://sihoo.example/products/table-4" },
        { position: 3, title: "60 inch rectangular wood dining table", source: "Home Store - Official Site", extracted_price: 500, delivery: "Free shipping", product_link: "https://home.example/products/table" },
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

  it("adds used eBay listings with item, shipping, and total prices", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const request = new URL(String(url));
      if (request.hostname === "api.ebay.com" && request.pathname.includes("oauth2/token")) {
        return { ok: true, json: async () => ({ access_token: "test-token", expires_in: 7200 }) };
      }
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
    expect(offer).toMatchObject({ category: "secondHand", merchant: "eBay · time-seller", itemPrice: 24, shippingPrice: 6.5, totalPrice: 30.5, priceVerified: true });
    const ebayCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("item_summary/search"));
    expect(String(ebayCall?.[0])).toContain("conditions%3A%7BUSED%7D%2CdeliveryCountry%3AIL");
  });
});
