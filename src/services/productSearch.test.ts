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
  it("preserves the server's quota explanation and reset time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Search provider quota has been used up.", resetAt: "2026-09-20T00:00:00Z" }) })));
    const result = await searchProducts("battery", "Israel");
    expect(result.partialFailure).toBe(true);
    expect(result.warnings?.[0]).toContain("quota has been used up");
    expect(result.warnings?.[0]).toContain("2026-09-20T00:00:00Z");
  });
  it("retains partial failure and attribute completion for the UI and WebMCP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], facets: [], partialFailure: true, attributesComplete: false, warnings: ["Provider blocked"] }) })));
    expect(await searchProducts("battery", "Israel")).toMatchObject({ partialFailure: true, attributesComplete: false, warnings: ["Provider blocked"] });
  });
});
