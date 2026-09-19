import { afterEach, expect, it, vi } from "vitest";
import { searchProvider } from "./providers.mjs";
import { searchCatalog } from "./search.mjs";
import { withSearchBudget } from "./search-budget.mjs";

afterEach(() => vi.unstubAllGlobals());

it("reserves backup for products when map lookup fails first and cuts off a stalled primary", async () => {
  const searches = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("brightdata.com")) {
      const q = new URL(JSON.parse(options.body).url).searchParams.get("q");
      if (q.includes("stores")) throw new DOMException("Timed out", "TimeoutError");
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }
    if (String(url).includes("account.json")) return Response.json({ total_searches_left: 40 });
    searches.push(new URL(url).searchParams.get("q"));
    return Response.json({ organic_results: [{ title: "Wireless mouse", link: "https://merchant.example/product/mouse" }] });
  }));
  const config = { apiKey: "stalled-fixture", zone: "zone", fallbackApiKey: "reserved-fixture" };
  const start = Date.now();
  await withSearchBudget(async () => {
    await expect(searchProvider(new URLSearchParams({ engine: "google", q: "computer stores near city" }), config)).rejects.toThrow();
    const page = await searchProvider(new URLSearchParams({ engine: "google", q: "wireless mouse price" }), config, 7500, { productDiscovery: true });
    expect(page.organic_results).toHaveLength(1);
  });
  expect(Date.now() - start).toBeLessThan(4500);
  expect(searches).toEqual(["wireless mouse price"]);
});

it("returns priced non-marketplace products through the full search when the primary is blocked", async () => {
  const paidQueries = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const host = new URL(url).hostname;
    if (host === "api.brightdata.com") return Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha" } });
    if (String(url).includes("account.json")) return Response.json({ total_searches_left: 40 });
    if (String(url).includes("serpapi.com/search.json")) {
      paidQueries.push(new URL(url).searchParams.get("q"));
      return Response.json({ organic_results: ["one", "two"].map(id => ({ title: "Logitech wireless mouse M185", link: `https://shop-${id}.co.il/products/m185` })) });
    }
    if (host.startsWith("shop-")) return new Response('<script type="application/ld+json">' + JSON.stringify({ "@type": "Product", name: "Logitech wireless mouse M185", image: "/mouse.jpg", brand: "Logitech", offers: { price: 59, priceCurrency: "ILS", availability: "https://schema.org/InStock" } }) + '</script>', { headers: { "content-type": "text/html" } });
    return Response.json({ elements: [] });
  }));
  const result = await searchCatalog("wireless mouse recovery fixture", "Israel", { apiKey: "blocked-recovery", zone: "zone", fallbackApiKey: "full-recovery" });
  expect(result.offers).toHaveLength(2);
  expect(result.offers.every(offer => offer.itemPrice === 59 && offer.imageUrl.endsWith("mouse.jpg") && offer.destinationUrl.includes("/products/m185"))).toBe(true);
  expect(paidQueries).toHaveLength(1);
  expect(paidQueries[0]).toBe("wireless mouse recovery fixture site:.il");
  expect(paidQueries[0]).not.toContain("stores near");
});
