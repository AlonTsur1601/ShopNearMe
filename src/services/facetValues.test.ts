import { describe, expect, it } from "vitest";
import { matchesFacets } from "./facetValues";
describe("matching product attributes", () => {
  it("matches all options only through an actual product attribute", () => {
    expect(matchesFacets({}, { color: ["Black", "White"] })).toBe(false);
    expect(matchesFacets({ color: "Black" }, { color: ["Black", "White"] })).toBe(true);
    expect(matchesFacets({ color: "White" }, { color: ["Black", "White"] })).toBe(true);
    expect(matchesFacets({ brand: "LG" }, { color: ["Black", "White"], brand: ["ASUS"] })).toBe(false);
    expect(matchesFacets({}, {})).toBe(true);
  });
  it("supports OR within a facet and AND across facets identically for local and shipped products", () => {
    const attributes = { ports: ["HDMI", "USB-C"], speakers: ["No"], brand: "ASUS" };
    expect(matchesFacets(attributes, { ports: ["DisplayPort", "USB-C"], speakers: ["No"] })).toBe(true);
    expect(matchesFacets(attributes, { ports: ["USB-C"], speakers: ["Yes"] })).toBe(false);
    expect(matchesFacets({}, { speakers: ["No"] })).toBe(false);
  });
});
