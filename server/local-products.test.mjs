import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { searchCatalog, recoverModelSpecifications } from "./search.mjs";
import { englishLabel, translateTerms } from "./facet-language.mjs";
import { matchesFacets } from "../src/services/facetValues.ts";

afterEach(() => vi.unstubAllGlobals());
const html = (name, description, price = 90) => '<script type="application/ld+json">' + JSON.stringify({ "@type": "Product", name, brand: "מותג - ACME", description, image: "/product.jpg", offers: { price, priceCurrency: "ILS" } }) + '</script>';

it.each(["local pack", "OSM", "typed location"])("returns actual nearby products via %s when Maps fails and Shopping already succeeds", async source => {
  const queries = [];
  const coordinates = source === "typed location" ? undefined : { lat: source === "OSM" ? 32.064 : 32.059, lon: 34.856 };
  const location = source === "typed location" ? "Givatayim, Israel" : source === "OSM" ? "Ramat Gan, Israel" : "Kiryat Ono, Israel";
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const host = new URL(url).hostname;
    if (host.endsWith(".co.il")) return new Response(html("Fixture laptop stand", "עשוי מאלומיניום כסוף ומתקפל", host === "nearby.co.il" ? 90 : 120), { headers: { "content-type": "text/html" } });
    if (host === "nominatim.openstreetmap.org") return Response.json([{ lat: "32.069", lon: "34.856", addresstype: "city" }]);
    if (host === "overpass-api.de") return Response.json({ elements: source !== "local pack" ? [{ type: "node", id: 444, lat: 32.06, lon: 34.856, tags: { name: "חנות", "name:en": "Nearby", shop: "computer" } }] : [] });
    const target = new URL(JSON.parse(options.body).url), q = target.searchParams.get("q") || "";
    queries.push(q);
    if (target.pathname.startsWith("/maps/")) throw new DOMException("Fixture Maps timeout", "TimeoutError");
    if (target.searchParams.get("tbm") === "shop") return Response.json({ shopping: [{ title: "Fixture laptop stand", shop: "Online", link: "https://online.co.il/product/stand" }] });
    if (q.includes("stores near")) return Response.json({ snack_pack: source === "local pack" ? [{ cid: "fixture-nearby", name: "Nearby - Central", type: "Computer store", address: "1 Main St" }] : [] });
    if (q.includes('"Nearby')) return Response.json({ organic: [{ title: "Fixture laptop stand", link: "https://nearby.co.il/product/stand" }] });
    return Response.json({});
  }));
  const result = await searchCatalog("Fixture laptop stand", location, { apiKey: source, zone: "test" }, coordinates);
  expect(queries.some(q => q.includes('"Nearby'))).toBe(true);
  expect(result.offers.find(offer => offer.category === "local")).toMatchObject({ itemPrice: 90, destinationUrl: "https://nearby.co.il/product/stand", imageUrl: "https://nearby.co.il/product.jpg", attributes: { material: "Aluminum", color: "Silver", features: "Foldable", brand: ["ACME"] } });
  expect(result.offers.some(offer => offer.merchant === "Online")).toBe(true);
  expect(result.warnings).toEqual([]);
  expect(result.facets.map(facet => facet.id)).toEqual(expect.arrayContaining(["features", "material", "brand", "retailer"]));
  for (const facet of result.facets) {
    expect(result.offers.every(offer => [offer.attributes[facet.id]].flat().some(Boolean))).toBe(true);
    expect(result.offers.filter(offer => matchesFacets(offer.attributes, { [facet.id]: facet.options.map(option => option.value) }))).toHaveLength(result.offers.length);
    for (const option of facet.options) expect(result.offers.filter(offer => matchesFacets(offer.attributes, { [facet.id]: [option.value] }))).toHaveLength(option.count);
  }
  const calls = vi.mocked(fetch).mock.calls.length;
  await searchCatalog("Fixture laptop stand", location, { apiKey: source, zone: "test" }, coordinates);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(calls);
});

it("recognizes Hebrew prefixes across categories and keeps all predefined filter labels", () => {
  expect(translateTerms("מאלומיניום ומתקפל מעץ ובשחור")).toBe("Aluminum Foldable Wood Black");
  expect(translateTerms("מחשב נייד")).not.toContain("Portable");
  const source = readFileSync("server/search.mjs", "utf8");
  for (const [, label] of source.matchAll(/label: "([^"]+)"/g)) expect(englishLabel(label), label).not.toBe("");
});

it("never starts specification lookups after the shared deadline or exceeds its request allowance", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  const offers = Array.from({ length: 30 }, (_, i) => ({ title: `Fixture laptop ModelA${i}`, attributes: { retailer: "Fixture" } }));
  await recoverModelSpecifications(offers, "laptop", "Israel", { apiKey: "deadline", zone: "test" }, ["memory"], false, { deadline: Date.now() - 1, remaining: 4 });
  expect(fetch).not.toHaveBeenCalled();
  const budget = { deadline: Date.now() + 15000, remaining: 4 };
  await recoverModelSpecifications(offers, "laptop", "Israel", { apiKey: "deadline", zone: "test" }, ["memory"], false, budget);
  await recoverModelSpecifications(offers, "laptop", "Israel", { apiKey: "deadline", zone: "test" }, ["memory"], true, budget);
  expect(fetch).toHaveBeenCalledTimes(4);
});
