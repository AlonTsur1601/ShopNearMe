import { afterEach, expect, it, vi } from "vitest";
import { catalogProductLinks } from "./catalog-products.mjs";
import { isRelevantProduct } from "./search.mjs";
afterEach(() => vi.unstubAllGlobals());
it("discovers relevant product links from catalogs without returning categories or unrelated links", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('<nav><a href="/navigation">Rechargeable battery</a></nav><a href="/batteries">Rechargeable batteries</a><a href="/product/aaa"><img alt="סוללות נטענות AAA"></a><a href="/product/aaa">Rechargeable batteries</a><a href="https://unrelated.example/item">Rechargeable batteries</a><a href="/cart">Rechargeable batteries</a><a href="/charger">Charger for rechargeable batteries</a>', { headers: { "content-type": "text/html" } })));
  const result = await catalogProductLinks("https://shop.example/batteries", title => isRelevantProduct(title, "rechargeable batteries"));
  expect(result).toEqual([{ title: "סוללות נטענות AAA", link: "https://shop.example/product/aaa" }]);
});
it("keeps catalog discovery bounded and returns no fabricated products on failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(Array.from({ length: 20 }, (_, i) => `<a href="/product/${i}">Battery ${i}</a>`).join(""), { headers: { "content-type": "text/html" } })));
  expect(await catalogProductLinks("https://shop.example/batteries", () => true)).toHaveLength(4);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Denied", { status: 403 })));
  expect(await catalogProductLinks("https://shop.example/batteries", () => true)).toEqual([]);
});
