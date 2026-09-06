import { afterEach, expect, it, vi } from "vitest";
import { brightDataSearch, brightDataSearchUrl } from "./brightdata.mjs";

afterEach(() => vi.unstubAllGlobals());
it("rejects editorial and category URLs rather than borrowing a recommendation price", async () => {
  const { isCategoryPage } = await import("./search.mjs");
  expect(isCategoryPage("Tent guide", "https://shop.example/blogs/news/tents-tips")).toBe(true);
  expect(isCategoryPage("Tents", "https://shop.example/collections/tents")).toBe(true);
  expect(isCategoryPage("אוהלים | Camping", "https://shop.example/7778-אוהלים")).toBe(true);
  expect(isCategoryPage("Camping tent 6 people", "https://shop.example/collections/tents/products/tent-6")).toBe(false);
});
it("targets shopping and local coordinates without forwarding credentials to Google", () => {
  const shopping = new URL(brightDataSearchUrl({ query: "OLED monitor", kind: "shopping", country: "IL", location: "Petah Tikva, Israel" }));
  expect(shopping.searchParams.get("tbm")).toBe("shop");
  expect(shopping.searchParams.get("gl")).toBe("il");
  expect(shopping.searchParams.get("brd_json")).toBe("1");
  expect(shopping.searchParams.has("api_key")).toBe(false);
  const maps = new URL(brightDataSearchUrl({ query: "computer stores", kind: "maps", coordinates: { lat: 32.084, lon: 34.887 }, start: 20 }));
  expect(maps.pathname).toContain("/@32.084,34.887,14z");
  expect(maps.searchParams.get("start")).toBe("20");
});
it("requires an explicitly configured zone before spending any requests", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(brightDataSearch({ query: "clock" }, { apiKey: "test" })).rejects.toThrow("BRIGHTDATA_SERP_ZONE");
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses native authenticated POST and coalesces then caches identical searches", async () => {
  const fetcher = vi.fn(async (url, options) => {
    expect(url).toBe("https://api.brightdata.com/request");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer fixture-key");
    expect(JSON.parse(options.body)).toMatchObject({ zone: "fixture-zone", format: "json" });
    return new Response(JSON.stringify({ organic: [{ title: "Clock", link: "https://merchant.example/clock" }] }));
  }); vi.stubGlobal("fetch", fetcher);
  const run = () => brightDataSearch({ query: "coalescing clock" }, { apiKey: "fixture-key", zone: "fixture-zone" });
  const [a, b] = await Promise.all([run(), run()]);
  expect(a).toEqual(b); await run(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retries a transient provider failure once", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response('{"organic":[]}'));
  vi.stubGlobal("fetch", fetcher);
  await brightDataSearch({ query: "retry" }, { apiKey: "test", zone: "zone" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("never echoes credentials in an upstream error or retries invalid credentials", async () => {
  const fetcher = vi.fn(async () => new Response("private fixture-key", { status: 401 })); vi.stubGlobal("fetch", fetcher);
  await expect(brightDataSearch({ query: "auth" }, { apiKey: "fixture-key", zone: "zone" })).rejects.toThrow("Bright Data search failed (HTTP 401)");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not mistake an HTML response for parsed data", async () => {
  const fetcher = vi.fn(async () => new Response("<html>not JSON</html>")); vi.stubGlobal("fetch", fetcher);
  await expect(brightDataSearch({ query: "html" }, { apiKey: "test", zone: "zone" })).rejects.toThrow("did not return parsed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("unwraps the native REST envelope used by a Full JSON zone", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status_code: 200, body: JSON.stringify({ organic: [{ title: "A product", link: "https://shop.example/product" }] }) }))));
  const data = await brightDataSearch({ query: "envelope" }, { apiKey: "test", zone: "zone" });
  expect(data.organic[0].title).toBe("A product");
});

it("maps native Maps coordinates, business categories and merchant links", async () => {
  const { searchProvider } = await import("./providers.mjs");
  vi.stubGlobal("fetch", vi.fn(async url => {
    expect(url).toBe("https://api.brightdata.com/request");
    return new Response(JSON.stringify({ organic: [{ title: "Computer shop", category: [{ id: "computer_store" }], link: "https://shop.example/", latitude: 32.1, longitude: 34.8, reviews_cnt: 42, map_id_encoded: "place1" }] }));
  }));
  const data = await searchProvider(new URLSearchParams({ engine: "google_maps", q: "native maps fixture" }), { apiKey: "test", zone: "zone" });
  expect(data.local_results[0]).toMatchObject({ title: "Computer shop", type: "computer store", website: "https://shop.example/", reviews: 42, gps_coordinates: { latitude: 32.1, longitude: 34.8 } });
});
