import { afterEach, describe, expect, it, vi } from "vitest";
import { searchProducts } from "./productSearch";

describe("searchProducts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a safe opt-in fallback when the live provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));
    const result = await searchProducts("desk lamp", "Current location");
    expect(result.source).toBe("fallback");
    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.offers.every((offer) => !offer.priceVerified && offer.totalPrice === null)).toBe(true);
  });
});
