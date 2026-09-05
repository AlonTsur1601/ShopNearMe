import { describe, expect, it } from "vitest";
import { matchesFacets } from "./facetValues";
describe("matching product attributes", () => {
  it("supports OR within a facet and AND across facets identically for local and shipped products", () => {
    const attributes = { ports: ["HDMI", "USB-C"], speakers: ["No"], brand: "ASUS" };
    expect(matchesFacets(attributes, { ports: ["DisplayPort", "USB-C"], speakers: ["No"] })).toBe(true);
    expect(matchesFacets(attributes, { ports: ["USB-C"], speakers: ["Yes"] })).toBe(false);
    expect(matchesFacets({}, { speakers: ["No"] })).toBe(false);
  });
});
