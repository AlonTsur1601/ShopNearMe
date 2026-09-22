import { afterEach, describe, expect, it, vi } from "vitest";
import { searchProducts, searchProductScope } from "./productSearch";

describe("searchProducts", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("resumes pending work with the original continuation instead of starting another search", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ offers: [], facets: [], pendingSearch: { continuation: "next", nextPollAt: 123 } }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchProductScope("mouse", "Israel", "all", undefined, undefined, "signed.token")).pendingSearch?.continuation).toBe("next");
    expect(fetch.mock.calls[0][0]).toContain("continuation=signed.token");
  });

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

it("publishes only the final set while following continuation deadlines", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ offers: [], facets: [], pendingSearch: { continuation: "job", nextPollAt: Date.now()+60000 } })).mockResolvedValueOnce(Response.json({ offers: [], facets: [], resultCount: 0 }));
  vi.stubGlobal("fetch", fetcher);
  let resolved = false;
  const promise = searchProducts("lamp", "Israel").then(value => { resolved = true; return value; });
  await vi.advanceTimersByTimeAsync(59000);
  expect(resolved).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000); await promise;
  expect(resolved).toBe(true); expect(fetcher.mock.calls[1][0]).toContain("continuation=job");
  vi.useRealTimers(); vi.unstubAllGlobals();
});
