import { describe, expect, it, vi, afterEach } from "vitest";
import { amountInCurrency, costBreakdown } from "./costs.mjs";
import { localizeOffers } from "./currency.mjs";
afterEach(() => vi.unstubAllGlobals());
describe("complete delivery costs", () => {
  it("adds shipping, import charges and taxes exactly once", () => {
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 20, importTaxPrice: 12, taxPrice: 5, crossBorder: true })).toMatchObject({ totalPrice: 137, otherFeesPrice: 0, totalEstimated: false, importTaxUnknown: false });
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 20, importTaxPrice: 12, providerTotal: 132 })).toMatchObject({ totalPrice: 132, otherFeesPrice: 0 });
  });
  it("retains supplier totals including tax and distinguishes unspecified import charges from zero", () => {
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 20, taxPrice: 10, providerTotal: 120 })).toMatchObject({ totalPrice: 120, taxesIncluded: true });
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 20, crossBorder: true })).toMatchObject({ totalPrice: 120, importTaxPrice: null, importTaxUnknown: true, totalEstimated: true });
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 0, importTaxPrice: 0, crossBorder: true })).toMatchObject({ totalPrice: 100, importTaxUnknown: false, totalEstimated: false });
    expect(costBreakdown({ itemPrice: 100, shippingPrice: 20, providerTotal: 125 })).toMatchObject({ otherFeesPrice: 5, totalPrice: 125 });
  });
  it("never mixes currencies and converts every fee with the same live exchange rate", async () => {
    expect(amountInCurrency({ value: "36", currency: "ILS", convertedFromValue: "10", convertedFromCurrency: "USD" }, "USD")).toBe(10);
    expect(amountInCurrency({ value: "36", currency: "ILS" }, "EUR")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ rate: 3, date: "2026-09-04" }) })));
    const [offer] = await localizeOffers([{ itemPrice: 100, currency: "USD", ...costBreakdown({ itemPrice: 100, shippingPrice: 20, importTaxPrice: 12, taxPrice: 5 }) }], "Israel");
    expect(offer).toMatchObject({ itemPrice: 300, shippingPrice: 60, importTaxPrice: 36, taxPrice: 15, totalPrice: 411, currency: "ILS" });
  });
});
