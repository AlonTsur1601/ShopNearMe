import { afterEach, describe, expect, it, vi } from "vitest";
import { searchProducts, searchProductScope } from "./productSearch";

describe("searchProducts", () => {
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("ends provider polling at two minutes, preserves collected products and remains cancellable", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const partial = { offers: [{ id: 'early' }], facets: [], pendingSearch: { continuation: 'accepted-slow-job', nextPollAt: Date.now() + 360000 } };
    const fetcher = vi.fn().mockResolvedValue(Response.json(partial));
    vi.stubGlobal('fetch', fetcher);
    let published = false;
    const search = searchProducts('slow lamp', 'Israel', controller.signal).then(result => { published = true; return result; });
    await vi.advanceTimersByTimeAsync(119999);
    expect(published).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await search).toMatchObject({ offers: [{ id: 'early' }], partialFailure: true, pendingSearch: undefined });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('shopnearme-pending-searches')!)[0].pending.continuation).toBe('accepted-slow-job');
    fetcher.mockResolvedValue(Response.json({ ...partial, pendingSearch: { ...partial.pendingSearch, nextPollAt: Date.now() + 360000 } }));
    const cancelled = searchProducts('another lamp', 'Israel', controller.signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await rejection;
  });
  it("retains accepted work after exhausted network retries and resumes it on the next search", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ offers: [], facets: [], pendingSearch: { continuation: "accepted-job", nextPollAt: Date.now() } }))
      .mockRejectedValueOnce(new TypeError("network")).mockRejectedValueOnce(new TypeError("network")).mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue(Response.json({ offers: [], facets: [], attributesComplete: true }));
    vi.stubGlobal("fetch", fetcher);
    const first = searchProducts("resume", "Israel");
    await vi.advanceTimersByTimeAsync(10000);
    expect((await first).partialFailure).toBe(true);
    const second = searchProducts("resume", "Israel");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await second).attributesComplete).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[4][1].body).continuation).toBe("accepted-job");
    await searchProducts("resume", "Israel");
    expect(fetcher.mock.calls[5][0]).toContain("/api/search?");
  });
  it("discards a rejected signed continuation and starts fresh only once", async () => {
    sessionStorage.setItem("shopnearme-pending-searches", JSON.stringify([{ key: JSON.stringify(["resume", "Israel", null, null]), expiresAt: Date.now() + 10000, pending: { continuation: "expired", nextPollAt: 0 } }]));
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "Expired", code: "invalid_continuation" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ offers: [], facets: [] }));
    vi.stubGlobal("fetch", fetcher);
    const promise = searchProducts("resume", "Israel");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await promise).source).toBe("live");
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(fetcher.mock.calls[1][0]).toContain("/api/search?");
    expect(JSON.parse(sessionStorage.getItem("shopnearme-pending-searches")!)).toEqual([]);
  });
  it("does not reuse jobs for another location or publish stored offers", async () => {
    sessionStorage.setItem("shopnearme-pending-searches", JSON.stringify([{ key: JSON.stringify(["lamp", "Israel", null, null]), expiresAt: Date.now() + 10000, pending: { continuation: "wrong-city", nextPollAt: 0 }, offers: [{ title: "cached" }] }]));
    const fetcher = vi.fn().mockResolvedValue(Response.json({ offers: [], facets: [] }));
    vi.stubGlobal("fetch", fetcher);
    expect((await searchProducts("lamp", "London")).offers).toEqual([]);
    expect(fetcher.mock.calls[0][0]).toContain("/api/search?");
  });
  it("resumes pending work with the original continuation instead of starting another search", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ offers: [], facets: [], pendingSearch: { continuation: "next", nextPollAt: 123 } }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchProductScope("mouse", "Israel", "all", undefined, undefined, "signed.token")).pendingSearch?.continuation).toBe("next");
    expect(fetch.mock.calls[0][0]).toBe("/api/search");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ q: "mouse", continuation: "signed.token" });
  });

  it("searches real providers for headphones and Sony instead of substituting demo offers", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], facets: [] }) }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchProducts("Sony headphones", "Tel Aviv, Israel")).source).toBe("live");
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("allows a complete provider response after twenty seconds within the two-minute budget", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, options) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ offers: [], facets: [], resultCount: 0 })), 30000);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const promise = searchProducts("diverse merchants", "Israel");
    await vi.advanceTimersByTimeAsync(30000);
    expect(await promise).toMatchObject({ source: "live", resultCount: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
  expect(resolved).toBe(true); expect(fetcher.mock.calls[1][0]).toBe("/api/search");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).continuation).toBe("job");
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it("recovers a transient continuation failure without starting or publishing another search", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ offers: [], facets: [], pendingSearch: { continuation: "same-job", nextPollAt: Date.now() } }))
    .mockRejectedValueOnce(new DOMException("Request timeout", "TimeoutError"))
    .mockResolvedValueOnce(Response.json({ offers: [], facets: [], resultCount: 0, attributesComplete: true }));
  vi.stubGlobal("fetch", fetcher);
  let resolved = false;
  const promise = searchProducts("resumed lamp", "Israel").then(value => { resolved = true; return value; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await promise).toMatchObject({ attributesComplete: true });
  expect(fetcher.mock.calls.slice(1).every(([, init]) => JSON.parse(init.body).continuation === "same-job")).toBe(true);
  vi.useRealTimers(); vi.unstubAllGlobals();
});
