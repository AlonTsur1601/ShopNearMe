import { afterEach, expect, it, vi } from "vitest";
import { brightDataSearch, brightDataSearchUrl } from "./brightdata.mjs";
import { withSearchBudget } from "./search-budget.mjs";

afterEach(() => vi.unstubAllGlobals());
it.each(["failed_query_rejected", "repeat_query_rejected", "sr_rate_limit", "bucket_rate_limit", "client_10110", "verifying"])("honors documented retry cooldown for %s across searches", async code => {
  const status = code === "verifying" ? 502 : 429;
  const fetcher = vi.fn(async () => new Response("private upstream details", { status, headers: { "x-brd-error-code": code } }));
  vi.stubGlobal("fetch", fetcher);
  const run = () => withSearchBudget(() => brightDataSearch({ query: "cooldown fixture " + code }, { apiKey: "test", zone: "zone" }));
  await expect(run()).rejects.toMatchObject({ status });
  await expect(run()).rejects.toMatchObject({ status });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("accepts documented product listing fields even without an organic array", async () => {
  const { searchProvider } = await import("./providers.mjs");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ top_pla: [{ title: "Mouse", shop: "Merchant", price: "$15", link: "https://merchant.example/mouse", image: "https://merchant.example/mouse.jpg" }, { title: "View all", view_all: true }] })));
  const data = await searchProvider(new URLSearchParams({ engine: "google_shopping", q: "PLA fixture" }), { apiKey: "test", zone: "zone" });
  expect(data.shopping_results).toHaveLength(1);
  expect(data.shopping_results[0]).toMatchObject({ source: "Merchant", price: "$15", link: "https://merchant.example/mouse" });
});
it("isolates a blocked Maps source while permitting Shopping and web recovery", async () => {
  const fetcher = vi.fn(async (_url, options) => {
    const target = new URL(JSON.parse(options.body).url);
    if (target.pathname.startsWith("/maps")) return Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha" } });
    return Response.json(target.searchParams.has("udm") ? { shopping: [] } : { organic: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  await withSearchBudget(async () => {
    const config = { apiKey: "isolation-test", zone: "zone" };
    await expect(brightDataSearch({ query: "isolated source", kind: "maps" }, config)).rejects.toMatchObject({ code: "source_blocked" });
    await expect(brightDataSearch({ query: "isolated source", kind: "shopping" }, config)).resolves.toEqual({ shopping: [] });
    await expect(brightDataSearch({ query: "isolated source", kind: "web" }, config)).resolves.toEqual({ organic: [] });
    await expect(brightDataSearch({ query: "different maps request", kind: "maps" }, config)).rejects.toMatchObject({ code: "source_blocked" });
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("reads and caches the native local pack even without organic results or website links", async () => {
  const { searchProvider } = await import("./providers.mjs");
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ snack_pack: [{ cid: "pack-1", name: "Nearby PC - Central", type: "Computer store", address: "1 Main St", reviews_cnt: 12 }] })));
  vi.stubGlobal("fetch", fetcher);
  const run = () => searchProvider(new URLSearchParams({ engine: "google", q: "pack-only cache fixture" }), { apiKey: "test", zone: "zone" });
  const result = await run(); await run();
  expect(result.local_results[0]).toMatchObject({ place_id: "pack-1", title: "Nearby PC - Central", type: "Computer store", reviews: 12 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not pay for a second identical request after its deadline expired", async () => {
  const fetcher = vi.fn(async () => { throw new DOMException("Source timed out", "TimeoutError"); });
  vi.stubGlobal("fetch", fetcher);
  await expect(brightDataSearch({ query: "expired source fixture" }, { apiKey: "test", zone: "zone" })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects editorial and category URLs rather than borrowing a recommendation price", async () => {
  const { isCategoryPage } = await import("./search.mjs");
  expect(isCategoryPage("Tent guide", "https://shop.example/blogs/news/tents-tips")).toBe(true);
  expect(isCategoryPage("Tents", "https://shop.example/collections/tents")).toBe(true);
  expect(isCategoryPage("אוהלים | Camping", "https://shop.example/7778-אוהלים")).toBe(true);
  expect(isCategoryPage("Camping tent 6 people", "https://shop.example/collections/tents/products/tent-6")).toBe(false);
});
it("targets shopping and local coordinates without forwarding credentials to Google", () => {
  const shopping = new URL(brightDataSearchUrl({ query: "OLED monitor", kind: "shopping", country: "IL", location: "Petah Tikva, Israel" }));
  expect(shopping.searchParams.get("udm")).toBe("28");
  expect(shopping.searchParams.has("tbm")).toBe(false);
  expect(shopping.searchParams.get("brd_browser")).toBe("chrome");
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
it.each(["he", "fr"])("preserves the requested search language (%s) through the provider adapter", async language => {
  const { searchProvider } = await import("./providers.mjs");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const target = new URL(JSON.parse(options.body).url);
    expect(target.searchParams.get("hl")).toBe(language);
    return Response.json({ organic: [] });
  }));
  await searchProvider(new URLSearchParams({ engine: "google", q: "language fixture " + language, hl: language }), { apiKey: "fixture", zone: "zone" });
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
it("identifies a CAPTCHA without paying for an identical retry or exposing upstream text", async () => {
  const fetcher = vi.fn(async () => Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha", "x-brd-error": "private fixture" }, body: "" }));
  vi.stubGlobal("fetch", fetcher);
  const error = await brightDataSearch({ query: "blocked fixture" }, { apiKey: "test", zone: "zone" }).catch(value => value);
  expect(error).toMatchObject({ code: "source_blocked", status: 502 });
  expect(error.message).not.toContain("private fixture");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("never echoes credentials in an upstream error or retries invalid credentials", async () => {
  const fetcher = vi.fn(async () => new Response("private fixture-key", { status: 401 })); vi.stubGlobal("fetch", fetcher);
  await expect(brightDataSearch({ query: "auth" }, { apiKey: "fixture-key", zone: "zone" })).rejects.toThrow("Bright Data search failed (HTTP 401)");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("identifies exhausted provider credits and preserves an advertised reset time", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Monthly credit quota exhausted", { status: 402, headers: { "Retry-After": "3600" } })));
  const error = await brightDataSearch({ query: "quota boundary" }, { apiKey: "test", zone: "zone" }).catch(value => value);
  expect(error).toMatchObject({ code: "quota_exhausted", status: 402 });
  expect(Number.isNaN(Date.parse(error.resetAt))).toBe(false);
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

it("accepts alternate native shopping and Maps result fields", async () => {
  const { searchProvider } = await import("./providers.mjs");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const target = new URL(JSON.parse(options.body).url);
    return new Response(JSON.stringify(target.pathname.startsWith("/maps/")
      ? { local: { places: [{ name: "Gaming Store", business_url: "https://gaming.example/", category: "gaming store", latitude: 32.1, longitude: 34.8 }] } }
      : { shopping: [{ title: "Gaming Laptop RAM 16GB", url: "https://online.example/laptop", shop: "Online" }] }));
  }));
  const maps = await searchProvider(new URLSearchParams({ engine: "google_maps", q: "alternate maps fixture" }), { apiKey: "test", zone: "zone" });
  expect(maps.local_results[0]).toMatchObject({ title: "Gaming Store", website: "https://gaming.example/" });
  const shopping = await searchProvider(new URLSearchParams({ engine: "google_shopping", q: "alternate shopping fixture" }), { apiKey: "test", zone: "zone" });
  expect(shopping.shopping_results[0]).toMatchObject({ title: "Gaming Laptop RAM 16GB", link: "https://online.example/laptop", source: "Online" });
});
