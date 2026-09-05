import { describe, expect, it } from "vitest";
import { recommendationsFor } from "./recommendations";

describe("recommendationsFor", () => {
  it("returns complementary products instead of repeating a search with deals", () => {
    expect(recommendationsFor(["Dining table"])).toEqual(["dining chairs", "table protector", "pendant light"]);
    expect(recommendationsFor(["unknown specialty item"])).toEqual(["unknown specialty item accessories", "unknown specialty item replacement parts", "unknown specialty item care kit"]);
  });

  it("combines and deduplicates recommendations from recent categories", () => {
    const values = recommendationsFor(["iPhone", "laptop"]);
    expect(values).toContain("protective phone case");
    expect(values).toContain("laptop sleeve");
    expect(new Set(values).size).toBe(values.length);
  });

  it("replenishes three suggestions after earlier recommendations were used", () => {
    const values = recommendationsFor(["USB-C fast charger", "screen protector", "protective phone case", "iPhone"]);
    expect(values).toHaveLength(3);
    expect(values).not.toEqual(expect.arrayContaining(["USB-C fast charger", "screen protector", "protective phone case"]));
  });
});
