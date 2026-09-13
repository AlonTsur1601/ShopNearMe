import { afterEach, expect, it, vi } from "vitest";
import { isRelevantProduct, searchCatalog } from "./search.mjs";
import { enrichProductPage } from "./product-page.mjs";
import { englishText, translateTerms } from "./facet-language.mjs";

afterEach(() => vi.unstubAllGlobals());

it("rejects numbered catalog pages before borrowing a product card's price", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect(await enrichProductPage("https://www.lastprice.co.il/c/898/computers/docks")).toEqual({ isCatalog: true });
  expect(fetch).not.toHaveBeenCalled();
});

it("does not invent a marble material from Hebrew prose meaning 'that has'", () => {
  expect(translateTerms("מגבלת חיבור למסך אחד, שיש במחשבי מק")).not.toContain("Marble");
  expect(translateTerms("שולחן שיש לבן")).toContain("Marble");
  expect(englishText("שיש")).toBe("Marble");
});

it("recognizes localized docks without accepting a USB charger or cable", () => {
  expect(isRelevantProduct("תחנת עגינה USB-C Belkin", "USB-C dock")).toBe(true);
  expect(isRelevantProduct("תחנות עגינה Dell", "docking station")).toBe(true);
  expect(isRelevantProduct("USB-C charger 65W", "USB-C dock")).toBe(false);
  expect(isRelevantProduct("USB-C cable", "USB-C dock")).toBe(false);
});

it.each(["upstream failure", "catalog only"])("recovers real retailer products after %s with one shared alternate query", async failure => {
  const calls = [], query = "USB-C dock " + failure;
  const link = "https://dock-fixture.co.il/products/" + encodeURIComponent(failure);
  const title = "תחנת עגינה USB-C HDMI שחור Belkin";
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("api.brightdata.com")) {
      const target = new URL(JSON.parse(options.body).url);
      calls.push(target);
      if (target.searchParams.get("tbm") === "shop") {
        // Retailer discovery must have started before Shopping finishes.
        expect(calls.some(call => !call.searchParams.has("tbm"))).toBe(true);
        return Response.json({ shopping: Array.from({ length: 8 }, (_, n) => ({ title: "USB-C dock model " + n, shop: "Shop " + n, price: "₪9999", url: "https://www.google.com/search?udm=28&prds=" + n })) });
      }
      if (target.searchParams.get("q").includes("-inurl:cat")) {
        return failure === "upstream failure" ? Response.json({ status_code: 502 }) : Response.json({ organic: [{ title, url: "https://dock-fixture.co.il/category/docks" }] });
      }
      return Response.json({ organic: [{ title, url: link, description: "USB-C HDMI Black", price: "₪900" }] });
    }
    if (String(url) === link) return new Response('<script type="application/ld+json">' + JSON.stringify({ "@type": "Product", name: title, image: "/dock.jpg", brand: "Belkin", offers: { price: 249, priceCurrency: "ILS", availability: "https://schema.org/InStock" }, additionalProperty: [{ name: "Color", value: "Black" }, { name: "Ports", value: "USB-C, HDMI" }] }) + "</script>", { headers: { "Content-Type": "text/html" } });
    throw new Error("Unexpected request: " + url);
  }));
  const result = await searchCatalog(query, "Israel", { apiKey: "fixture-" + failure, zone: "fixture" }, undefined, undefined, "online");
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0]).toMatchObject({ category: "order", itemPrice: 249, currency: "ILS", imageUrl: "https://dock-fixture.co.il/dock.jpg", destinationUrl: link, priceVerified: true });
  expect(result.warnings).toEqual([]);
  expect(result.facets.length).toBeGreaterThan(0);
  for (const facet of result.facets) expect(result.offers[0].attributes[facet.id]).toBeTruthy();
  const web = calls.filter(call => !call.searchParams.has("tbm"));
  expect(web.every(call => !/-inurl:cat(?:\s|$)/.test(call.searchParams.get("q")))).toBe(true);
  expect(new Set(web.map(call => call.searchParams.get("q"))).size).toBe(2);
  expect(web).toHaveLength(failure === "upstream failure" ? 3 : 2);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === link)).toHaveLength(1);
});

it("stops retailer recovery on exhausted quota and preserves the reset notice", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Credit quota exhausted", { status: 402, headers: { "Retry-After": "3600" } })));
  const result = await searchCatalog("USB-C dock quota recovery", "Israel", { apiKey: "quota-fixture", zone: "fixture" }, undefined, undefined, "online");
  expect(fetch).toHaveBeenCalledTimes(2); // Shopping plus the shared retailer search; no retries.
  expect(result.offers).toEqual([]);
  expect(result.warnings.join(" ")).toMatch(/quota has been used up.*will reset/i);
});

it.each([403, 404])("uses exact indexed merchant/model evidence for a blocked page, but rejects deletion (%s)", async status => {
  const query = "USB-C dock blocked " + status, link = `https://fixture-shop.co.il/products/inc002-${status}`;
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("api.brightdata.com")) {
      const target = new URL(JSON.parse(options.body).url), q = target.searchParams.get("q");
      if (target.searchParams.get("tbm") === "shop") return Response.json({ shopping: [{ title: "Belkin USB-C Dock INC002VFBK", shop: "Fixture Shop", price: "₪999", image: "https://fixture-shop.co.il/dock.jpg", url: "https://www.google.com/search?udm=28&prds=fixture" }] });
      return Response.json({ organic: q.includes("INC002VFBK") ? [
        { title: "Belkin USB-C Dock INC002VFBK", source: "Different Shop", url: "https://other.co.il/products/inc002" },
        { title: "Belkin USB-C Dock INC999VFBK", source: "Fixture Shop", url: "https://fixture-shop.co.il/products/inc999" },
        { title: "Belkin USB-C Dock INC002VFBK", source: "Fixture Shop", url: link },
      ] : [] });
    }
    expect(String(url)).toBe(link);
    return new Response("Unavailable", { status });
  }));
  const result = await searchCatalog(query, "Israel", { apiKey: "blocked-" + status, zone: "fixture" }, undefined, undefined, "online");
  if (status === 403) {
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ destinationUrl: link, itemPrice: 999, imageUrl: "https://fixture-shop.co.il/dock.jpg", priceVerified: false });
  } else expect(result.offers).toEqual([]);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("api.brightdata.com"))).toHaveLength(4);
});
