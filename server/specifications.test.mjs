import { afterEach, describe, expect, it, vi } from "vitest";
import { extractProductData } from "./product-page.mjs";
import { buildFacets, searchCatalog } from "./search.mjs";
import { monitorAttributes, specificationPairs, structuredAttributes } from "./specifications.mjs";

afterEach(() => vi.unstubAllGlobals());
describe("specification-driven facets", () => {
  it.each([
    ["air purifier", "CADR", "300 m³/h", "450 m³/h"],
    ["camping tent", "Hydrostatic head", "3000 mm", "5000 mm"],
    ["running shoes", "Heel to toe drop", "8 mm", "4 mm"],
    ["telescope", "Aperture", "130 mm", "200 mm"],
    ["dining table", "Length", "180 cm", "220 cm"],
    ["washing machine", "Spin speed", "1200 rpm", "1400 rpm"],
  ])("discovers %s properties absent from any predefined category", async (query, label, first, second) => {
    vi.stubGlobal("fetch", vi.fn(async url => {
      const request = new URL(url);
      if (request.hostname === "serpapi.com") return { ok: true, json: async () => ({ shopping_results: [first, second].map((value, index) => ({ title: `${query} ${index}`, source: `Shop ${index}`, price: "$200", extracted_price: 200, thumbnail: "https://img.example/product.jpg", link: `https://fixture.example/${encodeURIComponent(query)}/${index}` })) }) };
      const index = Number(request.pathname.split("/").at(-1));
      return { ok: true, url: request.href, headers: { get: () => "text/html" }, text: async () => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: `${query} ${index}`, brand: { name: "Maker" }, additionalProperty: [{ name: label, value: [first, second][index] }], offers: { price: 200, priceCurrency: "USD" } })}</script>` };
    }));
    const result = await searchCatalog(query, "United States", "fixture", undefined, undefined, "online");
    const facet = result.facets.find(f => f.label.toLowerCase() === label.toLowerCase());
    expect(facet?.options.map(o => o.value)).toEqual([first, second]);
    expect(result.offers.every(o => o.attributeLabels[facet.id])).toBe(true);
    expect(result.facets.find(f => f.label === "Manufacturer")?.options[0].value).toBe("MAKER");
    expect(result.facets.find(f => f.label === "Retailer")?.options).toHaveLength(2);
  });

  it("extracts JSON-LD, specification tables and definition lists without selling metadata", () => {
    const page = extractProductData('<table><tr><th>Ports</th><td>HDMI, USB-C</td></tr><tr><td>Shipping price</td><td>$20</td></tr></table><dl><dt>Hydrostatic head</dt><dd>5000 mm</dd></dl>');
    const data = structuredAttributes(page.specifications);
    expect(data.attributes.ports).toEqual(["HDMI", "USB-C"]);
    expect(data.attributes["spec:hydrostatic_head"]).toEqual(["5000 mm"]);
    expect(Object.keys(data.attributes).some(key => /shipping/.test(key))).toBe(false);
  });

  it("normalizes requested monitor specs, multivalues, weights and equivalent labels", () => {
    const specs = structuredAttributes(specificationPairs({
      "Display diagonal": "27 inches", "Screen surface": "anti-glare", "VESA mount": "100 x 100 mm",
      "Height adjustable": true, "Tilt": "-5 to 20 degrees", "Swivel": true, "Pivot": false,
      "Item weight": "5400 g", "Integrated speakers": false, "Video inputs": ["HDMI 2.1", "USB-C", "DisplayPort 1.4"],
      "Manufacturer": "ASUS", "Adaptive sync": "G-Sync, FreeSync", "Panel type": "OLED",
    }));
    expect(specs.attributes).toMatchObject({ screenSize: ["27 in"], finish: ["Matte / anti-glare"], mounting: ["100 x 100 mm"], weight: ["5.4 kg"], speakers: ["No"], heightAdjustment: ["Yes"], pivot: ["No"], brand: ["ASUS"], adaptiveSync: ["G-Sync", "FreeSync"] });
    const facets = buildFacets([{ attributes: specs.attributes, attributeLabels: specs.labels }], "monitor");
    expect(facets.map(f => f.id)).toEqual(expect.arrayContaining(["screenSize", "finish", "mounting", "heightAdjustment", "tilt", "swivel", "pivot", "weight", "speakers", "ports", "adaptiveSync", "brand"]));
    expect(facets.find(f => f.id === "ports").options.map(o => o.value)).toEqual(expect.arrayContaining(["HDMI 2.1", "HDMI", "USB-C", "DisplayPort 1.4", "DisplayPort"]));
  });

  it("does not treat absent attributes as no, or combine counts for one multi-valued offer twice", () => {
    const known = monitorAttributes("monitor", "Glossy wall-mountable, no built-in speakers, height-adjustable stand; HDMI USB-C G-Sync FreeSync");
    expect(known.attributes.speakers).toEqual(["No"]);
    expect(known.attributes.ports).toEqual(["HDMI", "USB-C"]);
    expect(monitorAttributes("monitor", "27 inch monitor").attributes.speakers).toBeUndefined();
    expect(monitorAttributes("camping tent", "glossy fabric").attributes).toEqual({});
    const facets = buildFacets([{ attributes: { ports: ["HDMI", "HDMI", "USB-C"] }, attributeLabels: { ports: "Ports" } }, { attributes: {} }], "monitor");
    expect(facets.find(f => f.id === "ports").options).toEqual([{ value: "HDMI", count: 1 }, { value: "USB-C", count: 1 }]);
  });

  it("cleans store interface noise, preserves generic sizes and splits multiple features", () => {
    const data = structuredAttributes(specificationPairs({ "Monitor Refresh Rate (Hz) Exited tooltip": "240", "Attribute name": "Attribute value", "גודל": "XL", "Connector type": "HDMI 2.1, USB-C", "Features": "Waterproof, Foldable" }));
    expect(data.attributes).toMatchObject({ refreshRate: ["240 Hz"], size: ["XL"], ports: ["HDMI 2.1", "USB-C", "HDMI"], features: ["Waterproof", "Foldable"] });
    expect(data.attributes.screenSize).toBeUndefined();
    expect(data.labels["spec:attribute_name"]).toBeUndefined();
  });
});
