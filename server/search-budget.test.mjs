import { afterEach, expect, it, vi } from "vitest";
import { captureOffer, searchSignal, withSearchBudget, SEARCH_BUDGET_MS } from "./search-budget.mjs";
import { searchCatalog } from "./search.mjs";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("returns captured offers and aborts outstanding work at the overall deadline", async () => {
  vi.useFakeTimers();
  let signal;
  const fallback = vi.fn(offers => offers);
  const promise = withSearchBudget(async () => {
    signal = searchSignal();
    captureOffer({ category: "order", destinationUrl: "https://fixture.test/1", itemPrice: 10 });
    await new Promise(() => {});
  }, fallback);
  await vi.advanceTimersByTimeAsync(SEARCH_BUDGET_MS - 1);
  expect(fallback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await promise).toHaveLength(1);
  expect(signal.aborted).toBe(true);
});
it("returns a deterministically parsed product when another discovery query exceeds the deadline", async () => {
  vi.useFakeTimers();
  let searches = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).startsWith("https://serpapi.com")) {
      searches++;
      if (searches > 1) return new Promise(() => {});
      return new Response(JSON.stringify({ organic_results: [{ title: "Latency tent", link: "https://latency.co.il/product/tent", source: "Latency Store" }] }));
    }
    return new Response('<script type="application/ld+json">{"@type":"Product","name":"Latency tent","brand":"Maker","model":"LAT-100","additionalProperty":[{"name":"Windows","value":"No"}],"offers":{"price":100,"priceCurrency":"ILS"}}</script>', { headers: { "content-type": "text/html" } });
  }));
  const promise = searchCatalog("Latency tent", "Israel", "latency-fixture", undefined, undefined, "local-products");
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(19000);
  const result = await promise;
  expect(result.offers).toHaveLength(1);
  expect(result.offers[0].attributes["spec:windows"]).toEqual(["No"]);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings.join(" ")).toContain("too long");
});
