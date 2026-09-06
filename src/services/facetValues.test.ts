import { describe, expect, it } from "vitest";
import { matchesFacets } from "./facetValues";
describe("matching product attributes", () => {
  it("treats every known option as no filter, including offers with unknown attributes", () => {
    const available = { color: ["Black", "White"], brand: ["ASUS", "LG"] };
    expect(matchesFacets({}, { color: ["Black", "White"] }, available)).toBe(true);
    expect(matchesFacets({}, { color: ["Black"] }, available)).toBe(false);
    expect(matchesFacets({ brand: "LG" }, { color: ["Black", "White"], brand: ["ASUS"] }, available)).toBe(false);
    expect(matchesFacets({}, { color: ["Black", "White", "old value"] }, available)).toBe(true);
  });
  it("supports OR within a facet and AND across facets identically for local and shipped products", () => {
    const attributes = { ports: ["HDMI", "USB-C"], speakers: ["No"], brand: "ASUS" };
    expect(matchesFacets(attributes, { ports: ["DisplayPort", "USB-C"], speakers: ["No"] })).toBe(true);
    expect(matchesFacets(attributes, { ports: ["USB-C"], speakers: ["Yes"] })).toBe(false);
    expect(matchesFacets({}, { speakers: ["No"] })).toBe(false);
  });
});
