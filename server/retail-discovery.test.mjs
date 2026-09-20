import { afterEach, expect, it, vi } from "vitest";
import { discoverRetailProducts } from "./retail-discovery.mjs";
import { brightDataSearch, brightDataSearchUrl } from "./brightdata.mjs";
import { searchRetailCatalog } from "./search.mjs";
import { withSearchBudget } from "./search-budget.mjs";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const options = () => ({ query: "desk lamp", country: "IL", config: {}, relevant: title => /lamp/i.test(title), isCatalog: (_title, url) => /\/category/.test(url), deadline: Date.now() + 16000 });
const product = (changes = {}) => ({ isProduct: true, title: "Desk lamp", price: 39, currency: "ILS", imageUrl: "https://merchant.example/lamp.jpg", ...changes });
const organic = links => ({ organic: links.map(link => ({ title: "Desk lamp", link })) });

it("uses independent engine URLs and a lightweight Google response", () => {
  const google = new URL(brightDataSearchUrl({ query: "desk lamp", light: true }));
  const bing = new URL(brightDataSearchUrl({ query: "desk lamp", engine: "bing", country: "IL" }));
  expect(google.searchParams.get("brd_json")).toBe("parsed_light");
  expect(bing.hostname).toBe("www.bing.com");
  expect(bing.searchParams.get("cc")).toBe("il");
  expect(bing.searchParams.has("udm")).toBe(false);
});

it("keeps Google blocking isolated from Bing", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => new URL(JSON.parse(init.body).url).hostname.includes("google")
    ? Response.json({ status_code: 502, headers: { "x-brd-error-code": "captcha" } }) : Response.json({ organic: [] })));
  await withSearchBudget(async () => {
    const config = { apiKey: "engine-isolation", zone: "test" };
    await expect(brightDataSearch({ query: "lamp", noRetry: true }, config)).rejects.toMatchObject({ code: "source_blocked" });
    await expect(brightDataSearch({ query: "lamp", engine: "bing", noRetry: true }, config)).resolves.toEqual({ organic: [] });
  });
});

it("validates fast results before the other engine settles and retains them on timeout", async () => {
  vi.useFakeTimers();
  const readPage = vi.fn(async () => product());
  const task = discoverRetailProducts(options(), { search: ({ engine }) => engine === "bing" ? Promise.resolve(organic(["https://merchant.example/lamp"])) : new Promise(() => {}), readPage });
  await vi.advanceTimersByTimeAsync(1);
  expect(readPage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9500);
  const result = await task;
  expect(result.products).toHaveLength(1);
  expect(result.sourceStatus).toContainEqual(expect.objectContaining({ source: "google", status: "failed", code: "search_timeout" }));
});

it.each([{ price: null }, { price: 0 }, { imageUrl: "" }, { isCatalog: true }, { unavailable: true }, { availability: "Out of stock" }, { title: "A toaster" }, { destinationUrl: "https://maps.apple.com/store" }])("rejects invalid product evidence %j", async change => {
  const result = await discoverRetailProducts(options(), { search: async () => organic(["https://merchant.example/lamp"]), readPage: async () => product(change), readCatalog: async () => [] });
  expect(result.products).toHaveLength(0);
});

it("deduplicates URLs across engines without dropping another merchant", async () => {
  const readPage = vi.fn(async () => product());
  const result = await discoverRetailProducts(options(), { search: async () => organic(["https://one.example/lamp", "https://two.example/lamp", "https://one.example/lamp"]), readPage });
  expect(result.products).toHaveLength(2);
  expect(readPage).toHaveBeenCalledTimes(2);
});

it("follows category links but never displays the category itself", async () => {
  const result = await discoverRetailProducts(options(), { search: async () => organic(["https://merchant.example/category"]), readPage: async url => url.endsWith("category") ? { isCatalog: true } : product(), readCatalog: async () => [{ title: "Lamp", link: "https://merchant.example/lamp" }] });
  expect(result.products.map(item => item.link)).toEqual(["https://merchant.example/lamp"]);
});

it("uses only one backup for empty successful responses", async () => {
  const backup = vi.fn(async () => organic(["https://merchant.example/lamp"]));
  const result = await discoverRetailProducts({ ...options(), config: { fallbackApiKey: "fixture" } }, { search: async () => ({ organic: [] }), backup, readPage: async () => product() });
  expect(result.products).toHaveLength(1);
  expect(backup).toHaveBeenCalledTimes(1);
  expect(backup.mock.calls[0][0].get("q")).toBe("desk lamp");
});

it("integrates real merchant evidence into local and online offers without map placeholder rows", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).includes("api.brightdata.com")) return Response.json(organic(["https://local.example/product/lamp", "https://online.example/product/lamp"]));
    if (String(url).includes("overpass-api.de")) return Response.json({ elements: [{ type: "node", id: 1, lat: 32.06, lon: 34.85, tags: { name: "Local", shop: "houseware", website: "https://local.example" } }] });
    const host = new URL(url).hostname;
    if (host === "local.example" || host === "online.example") return new Response(`<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Desk lamp", image: `https://${host}/lamp.jpg`, offers: { price: 39, priceCurrency: "ILS", availability: "https://schema.org/InStock" } })}</script>`, { headers: { "content-type": "text/html" } });
    throw new Error("Unexpected request to " + new URL(url).hostname + " " + (init?.method || "GET"));
  }));
  const result = await searchRetailCatalog("desk lamp", "Kiryat Ono, Israel", { apiKey: "new-pipeline-fixture", zone: "test" }, { lat: 32.06, lon: 34.85 });
  expect(result.offers.filter(item => item.category === "order")).toHaveLength(2);
  const local = result.offers.filter(item => item.category === "local");
  expect(local).toHaveLength(1);
  expect(local[0]).toMatchObject({ merchant: "local.example", itemPrice: 39, imageUrl: "https://local.example/lamp.jpg", destinationUrl: "https://local.example/product/lamp", pickupVerified: false });
  expect(result.offers.every(item => !item.potentialStore)).toBe(true);
  expect(result.sourceStatus.every(source => source.status === "completed")).toBe(true);
  expect(result.facets.some(facet => facet.id === "retailer" && facet.options.length === 2)).toBe(true);
});
