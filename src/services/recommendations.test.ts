import { describe, expect, it } from "vitest";
import { recommendationsFor } from "./recommendations";

describe("recommendationsFor", () => {
  it("returns complementary products instead of repeating a search with deals", () => {
    expect(recommendationsFor(["Dining table"])).toEqual(["dining chairs", "table protector", "pendant light"]);
    expect(recommendationsFor(["unknown specialty item"])).toEqual([]);
  });

  it("combines and deduplicates recommendations from recent categories", () => {
    const values = recommendationsFor(["iPhone", "laptop"]);
    expect(values).toContain("protective phone case");
    expect(values).toContain("wireless mouse");
    expect(new Set(values).size).toBe(values.length);
  });
});
