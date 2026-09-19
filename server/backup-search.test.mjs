import { afterEach, expect, it, vi } from "vitest";
import { backupSearch } from "./backup-search.mjs";
import { searchContext, withSearchBudget } from "./search-budget.mjs";
afterEach(() => vi.unstubAllGlobals());
it("permits one backup search and reuses the free quota check across searches", async () => {
  const fetcher = vi.fn(async url => Response.json(String(url).includes("account.json") ? { total_searches_left: 49 } : { organic_results: [{ title: "Product", link: "https://shop.example/product" }] }));
  vi.stubGlobal("fetch", fetcher);
  const error = new Error("Primary blocked"), params = new URLSearchParams({ engine: "google", q: "product", api_key: "wrong-primary-key" });
  await withSearchBudget(async () => {
    expect((await backupSearch(params, "backup-fixture", error)).organic_results).toHaveLength(1);
    await expect(backupSearch(new URLSearchParams({ q: "different product" }), "backup-fixture", error)).rejects.toBe(error);
  });
  await withSearchBudget(() => backupSearch(params, "backup-fixture", error));
  await withSearchBudget(() => backupSearch(new URLSearchParams({ q: "different product" }), "backup-fixture", error));
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("account.json"))).toHaveLength(1);
  const searches = fetcher.mock.calls.filter(([url]) => String(url).includes("search.json"));
  expect(searches).toHaveLength(2);
  expect(new URL(searches[0][0]).searchParams.get("api_key")).toBe("backup-fixture");
});
it("does not spend a request when the backup quota is empty and preserves its renewal date", async () => {
  const fetcher = vi.fn(async () => Response.json({ total_searches_left: 0, plan_renewal_date: "2026-10-01" }));
  vi.stubGlobal("fetch", fetcher);
  await withSearchBudget(async () => {
    const error = new Error("Primary blocked");
    await expect(backupSearch(new URLSearchParams(), "empty-fixture", error)).rejects.toBe(error);
    expect(searchContext().backupQuota).toEqual({ reset: "2026-10-01" });
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
