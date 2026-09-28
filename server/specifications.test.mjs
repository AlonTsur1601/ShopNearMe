import { afterEach, describe, expect, it, vi } from "vitest";
import { extractProductData } from "./product-page.mjs";
import { buildFacets, searchCatalog } from "./search.mjs";
import { extractMarkdownSpecifications, monitorAttributes, productMarkdownText, proseAttributes, specificationPairs, structuredAttributes } from "./specifications.mjs";
import { normalizeOfferFacets } from "./facet-language.mjs";

afterEach(() => vi.unstubAllGlobals());
describe("specification-driven facets", () => {
  it("reads source-stated prose dimensions without turning its introductory sentence or cord into product dimensions", () => {
    const content = 'This is a compact lamp: 14.0 in high, 4.5 in wide, 3.7 in base width, and the power cord is 59 in long.';
    expect(structuredAttributes(extractMarkdownSpecifications(content)).attributes).toEqual({});
    expect(proseAttributes(content).attributes).toEqual({ height: ['14.0 in'], width: ['4.5 in'], 'spec:base_width': ['3.7 in'], 'spec:cord_length': ['59 in'] });
    expect(proseAttributes('Tent: 210 cm wide, 150 cm high, 220 cm deep').attributes).toEqual({ width: ['210 cm'], height: ['150 cm'], depth: ['220 cm'] });
  });
  it("keeps video-player controls and seller identity out of product filters while preserving technical facts", () => {
    const content = '# Bedside lamp\nCurrent Time 0:00\nDuration 0:00\nRemaining Time 0:00\nLoaded: 0%\nSold by: JNO E-commerce US\nMaterial: Metal\nPower: 60 W\nDuration: 8 hours\nLoad capacity: 15 kg';
    expect(structuredAttributes(extractMarkdownSpecifications(content)).attributes).toEqual({ material: ['Metal'], power: ['60 W'], 'spec:duration': ['8 hours'], 'spec:load_capacity': ['15 kg'] });
    const html = '<main><video><p>Color: Red</p></video><audio><dl><dt>Duration</dt><dd>00:30</dd></dl></audio><p>Color: White</p><p>Power: 7 W</p></main>';
    expect(structuredAttributes(extractProductData(html).specifications).attributes).toEqual({ color: ['White'], power: ['7 W'] });
  });
  it("reads two-property horizontal tables without creating filters from table headings or values", () => {
    const html = '<table><tr><th>Color</th><th>Power</th></tr><tr><td>White</td><td>7 W</td></tr></table>';
    expect(structuredAttributes(extractProductData(html).specifications).attributes).toEqual({ color: ['White'], power: ['7 W'] });
    const vertical = '<table><tr><th>Property</th><th>Value</th></tr><tr><td>Material</td><td>Metal</td></tr></table>';
    expect(extractProductData(vertical).specifications).toEqual([{ name: 'Material', value: 'Metal' }]);
    expect(structuredAttributes(extractMarkdownSpecifications('| Memory | Storage |\n|---|---|\n|16 GB|512 GB|')).attributes).toEqual({ memory: ['16 GB'], storage: ['512 GB'] });
    expect(extractMarkdownSpecifications('|Property|Value|\n|---|---|\n|Color|White|')).toEqual([{ name: 'Color', value: 'White' }]);
  });
  it("keeps nested contacts and related-product facts out of structured and prose recovery", () => {
    const content = '# Product\nMaterial: Metal\n## Related products\n### Blue lamp\nColor: Blue\n#### Details\nPower: 40 W\n## Contact\n### Directions\nEntrances from the streets: Main street\n### Office\nColor: Green\n## Specifications\nColor: White\n### Electrical\nPower: 7 W';
    const text = productMarkdownText(content);
    expect(text).not.toMatch(/Blue|Green|40 W|Main street/);
    expect(structuredAttributes(extractMarkdownSpecifications(content)).attributes).toEqual({ material: ['Metal'], color: ['White'], power: ['7 W'] });
    expect(text).toContain('Power: 7 W');
  });
  it("preserves common translated materials and inflected colors from named merchant metadata", () => {
    const values = ['אקריליק', 'סיליקון', 'נירוסטה', 'פשתן', 'חרס', 'קרמיקה חומה/לבנה', 'שיש אוניקס ירוק', 'טרקוטה', 'אבן'];
    const offers = values.map(value => { const data = structuredAttributes([{ name: 'Material', value }]); return normalizeOfferFacets({ attributes: data.attributes, attributeLabels: data.labels }); });
    expect(offers.every(offer => offer.attributes.material?.length)).toBe(true);
    expect(offers[0].attributes.material).toEqual(['Acrylic']);
  });
  it("recovers named Markdown facts across products without adding comparisons or retailer contacts", () => {
    const content = '# Product\n\n| Property | Value |\n| --- | --- |\n| RAM Size | **16 GB DDR5** |\n| Color | White |\n| Hydrostatic head | 5000 mm |\n\n- Material: Metal\n- Phone: +97298821001\n\n| Color | Power | Material |\n| --- | --- | --- |\n| Red | 7 W | Glass |\n| Blue | 10 W | Metal |\n\n## Related products\n- Color: Green\n\n## Contact\n- Office size: 500 square feet';
    expect(structuredAttributes(extractMarkdownSpecifications(content)).attributes).toEqual({ memory: ["16 GB"], color: ["White"], "spec:hydrostatic_head": ["5000 mm"], material: ["Metal"] });
    expect(structuredAttributes(extractMarkdownSpecifications('| Aperture | Focal length | Optical design |\n| --- | --- | --- |\n| 130 mm | 650 mm | Reflector |')).attributes).toMatchObject({ "spec:aperture": ["130 mm"], "spec:focal_length": ["650 mm"] });
  });
  it("preserves source-backed technical vocabulary across extraction, normalization and facet building", () => {
    const specs = structuredAttributes([{ name: "Material type", value: "Borosilicate" }, { name: "Magnet composition", value: "Neodymium" }, { name: "Additional features", value: "Dimmable" }, { name: "Brand name", value: "Maker" }, { name: "One-time purchase", value: "$99" }, { name: "Color", value: "Other" }]);
    const offer = normalizeOfferFacets({ attributes: specs.attributes, attributeLabels: specs.labels });
    expect(offer.attributes).toMatchObject({ material: ["Borosilicate"], "spec:magnet_composition": ["Neodymium"], features: ["Dimmable"], brand: ["MAKER"] });
    expect(offer.attributes.color).toBeUndefined();
    expect(offer.attributes["spec:one_time_purchase"]).toBeUndefined();
    expect(buildFacets([offer], "glass bowl").find(facet => facet.id === "spec:magnet_composition")?.options).toEqual([{ value: "Neodymium", count: 1 }]);
  });
  it("rejects storage-sized values mislabeled as laptop memory", () => {
    expect(structuredAttributes([{ name: "Memory", value: "2 TB" }]).attributes.memory).toBeUndefined();
    expect(structuredAttributes([{ name: "Memory", value: "32 GB DDR5" }]).attributes.memory).toEqual(["32 GB"]);
    expect(structuredAttributes([{ name: "RAM Size", value: "16 GB" }]).attributes.memory).toEqual(["16 GB"]);
  });
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

  it("keeps retailer contact and opening-hour tables out of product facets", () => {
    const page = extractProductData('<main><table><tr><th>Phone compatibility</th><td>Android and iOS</td></tr><tr><th>Aperture</th><td>130 mm</td></tr><tr><th>Phone</th><td>+97298821001</td></tr><tr><th>Sunday - Thursday</th><td>11:00 - 24:00</td></tr></table></main><footer><table><tr><th>Office size</th><td>500 square feet</td></tr></table><dl><dt>Support channel</dt><dd>Telephone</dd></dl></footer>');
    expect(structuredAttributes(page.specifications).attributes).toEqual({ "spec:phone_compatibility": ["Android and iOS"], "spec:aperture": ["130 mm"] });
    expect(page.specifications.some(pair => pair.name === "Office size" || pair.name === "Support channel")).toBe(false);
  });

  it("rejects fulfillment and branch metadata without discarding physical product properties", () => {
    const pairs = [{ name: 'Ships from', value: 'USA' }, { name: 'Store address', value: 'Main street' }, { name: 'Branch location', value: 'City center' }, { name: 'Entrances from the streets', value: 'Main street' }, { name: 'Country of origin', value: 'USA' }, { name: 'Connector type', value: 'USB-C' }];
    expect(structuredAttributes(pairs).attributes).toEqual({ 'spec:country_of_origin': ['USA'], ports: ['USB-C'] });
    expect(productMarkdownText('# Contactless LED lamp\nColor: White')).toContain('Color: White');
  });

  it("reads transposed specification tables without assigning comparison rows to a product", () => {
    const page = extractProductData('<table><tr><td>צבע</td><td>הספק</td><td>חומר</td><td>מידות</td></tr><tr><td>שחור+לבן</td><td>7W</td><td><p>Glass</p><p>Metal</p></td><td><p>180 x 450</p><p>mm</p></td></tr></table>');
    expect(structuredAttributes(page.specifications).attributes).toMatchObject({ color: ["Black", "White"], power: ["7 W"], material: ["Glass", "Metal"], dimensions: ["180 x 450 mm"] });
    const custom = extractProductData('<table><tr><th>Aperture</th><th>Focal length</th><th>Optical design</th></tr><tr><td>130 mm</td><td>650 mm</td><td>Reflector</td></tr></table>');
    expect(structuredAttributes(custom.specifications).attributes["spec:aperture"]).toEqual(["130 mm"]);
    const variants = extractProductData('<table><tr><th>Color</th><th>Power</th><th>Material</th></tr><tr><td>Red</td><td>7 W</td><td>Glass</td></tr><tr><td>Blue</td><td>10 W</td><td>Metal</td></tr></table>');
    expect(variants.specifications).toEqual([]);
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
    expect(facets.find(f => f.id === "ports")).toMatchObject({ missingCount: 1 });
  });

  it("cleans store interface noise, preserves generic sizes and splits multiple features", () => {
    const data = structuredAttributes(specificationPairs({ "Monitor Refresh Rate (Hz) Exited tooltip": "240", "Attribute name": "Attribute value", "גודל": "XL", "Connector type": "HDMI 2.1, USB-C", "Features": "Waterproof, Foldable" }));
    expect(data.attributes).toMatchObject({ refreshRate: ["240 Hz"], size: ["XL"], ports: ["HDMI 2.1", "USB-C", "HDMI"], features: ["Waterproof", "Foldable"] });
    expect(data.attributes.screenSize).toBeUndefined();
    expect(data.labels["spec:attribute_name"]).toBeUndefined();
  });
});
