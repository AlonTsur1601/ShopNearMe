import { afterEach, expect, it, vi } from "vitest";
import { readMerchantProduct } from "./merchant-fetch.mjs";
import { withSearchBudget } from "./search-budget.mjs";

afterEach(() => vi.unstubAllGlobals());
const config = { apiKey: "fixture-key", productZone: "fixture-pages" };
const body = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Desk lamp", image: "/lamp.jpg", offers: { price: 39, priceCurrency: "ILS" } })}</script>`;

it("recovers a blocked merchant using the documented response envelope", async () => {
  const fetcher = vi.fn(async () => Response.json({ status_code: 200, body }));
  vi.stubGlobal("fetch", fetcher);
  const result = await withSearchBudget(() => readMerchantProduct("https://recovered.example/lamp", config, Date.now() + 10000, async () => ({})));
  expect(result).toMatchObject({ isProduct: true, price: 39, currency: "ILS", imageUrl: "https://recovered.example/lamp.jpg" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ zone: "fixture-pages", url: "https://recovered.example/lamp", format: "json" });
  await withSearchBudget(() => readMerchantProduct("https://recovered.example/lamp", config, Date.now() + 10000, async () => ({})));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("caps paid page reads at three per complete search", async () => {
  const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await withSearchBudget(() => Promise.all(Array.from({ length: 20 }, (_, i) => readMerchantProduct(`https://bounded.example/product/${i}`, config, Date.now() + 10000, async () => ({})))));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([{ unavailable: true }, { isCatalog: true }, { availability: "Out of stock" }, { isProduct: true, price: 39, imageUrl: "https://image.example/lamp.jpg" }])("does not pay for a page with conclusive direct evidence %j", async direct => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await withSearchBudget(() => readMerchantProduct("https://direct.example/lamp", config, Date.now() + 10000, async () => direct))).toEqual(direct);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["https://redirect.example/search?q=lamp", "https://other.example/lamp"])("rejects canonical redirects to %s", async canonical => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status_code: 200, body: `<link rel="canonical" href="${canonical}">${body}` })));
  expect(await withSearchBudget(() => readMerchantProduct("https://redirect.example/lamp", config, Date.now() + 10000, async () => ({})))).toEqual({ isCatalog: true });
});

it("does not turn a deleted product into a recovered offer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status_code: 410, body })));
  expect(await withSearchBudget(() => readMerchantProduct("https://deleted-fixture.example/lamp", config, Date.now() + 10000, async () => ({})))).toEqual({ unavailable: true });
});
