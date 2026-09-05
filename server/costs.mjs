export function amountInCurrency(amount, currency) {
  if (!amount || typeof amount !== "object") return null;
  const value = amount.currency === currency ? amount.value : amount.convertedFromCurrency === currency ? amount.convertedFromValue : undefined;
  const number = value === undefined ? NaN : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function costBreakdown({ itemPrice, shippingPrice, importTaxPrice = null, taxPrice = null, providerTotal = null, crossBorder = false }) {
  const sum = itemPrice === null ? null : itemPrice + (shippingPrice ?? 0) + (importTaxPrice ?? 0) + (taxPrice ?? 0);
  const totalPrice = providerTotal !== null && itemPrice !== null && providerTotal >= itemPrice ? providerTotal : sum;
  const otherFeesPrice = totalPrice !== null && sum !== null ? Math.max(0, Math.round((totalPrice - sum) * 100) / 100) : 0;
  return { shippingPrice, importTaxPrice, taxPrice, otherFeesPrice, totalPrice, taxesIncluded: totalPrice !== null && sum !== null && totalPrice < sum, importTaxUnknown: crossBorder && importTaxPrice === null, totalEstimated: shippingPrice === null || (crossBorder && importTaxPrice === null) };
}
