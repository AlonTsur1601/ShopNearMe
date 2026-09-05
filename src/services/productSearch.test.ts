import { afterEach, describe, expect, it, vi } from "vitest";
import { searchProducts } from "./productSearch";

describe("searchProducts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches real providers for headphones and Sony instead of substituting demo offers", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], facets: [] }) }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchProducts("Sony headphones", "Tel Aviv, Israel")).source).toBe("live");
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("returns a safe opt-in fallback when the live provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));
    const result = await searchProducts("desk lamp", "Current location");
    expect(result.source).toBe("fallback");
    expect(result.offers).toEqual([]);
  });
});
