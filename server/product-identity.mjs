const words = value => String(value ?? "").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
const codes = value => words(value).filter(word => /^[a-z]/.test(word) && /\d/.test(word) && (word.match(/[a-z]/g) ?? []).length >= 2 && word.length >= 5);
export function productBrand(offer, knownBrands = []) {
  const explicit = offer.productBrand || [offer.attributes?.brand].flat().filter(Boolean)[0];
  if (explicit) {
    const value = String(explicit).trim().toLowerCase();
    const shorter = [...new Set(knownBrands)].filter(brand => brand !== value && value.startsWith(brand + " ") && codes(value.slice(brand.length)).length);
    return shorter.length === 1 ? shorter[0] : value;
  }
  const title = ` ${words(offer.title).join(" ")} `;
  const matches = [...new Set(knownBrands)].filter(brand => brand.length >= 2 && title.includes(` ${words(brand).join(" ")} `));
  return matches.length === 1 ? matches[0] : "";
}
export function productIdentity(offer, knownBrands = []) {
  if (/^\d{8,14}$/.test(offer.gtin ?? "")) return "gtin:" + offer.gtin;
  const brand = productBrand(offer, knownBrands);
  if (!brand) return null;
  const declared = String(offer.mpn ?? "").trim();
  const identifiers = codes(declared || offer.title);
  const model = identifiers.length === 1 ? identifiers[0] : declared ? words(declared).join(" ") : "";
  if (!model || !/\d/.test(model) || !/[a-z]/.test(model)) return null;
  return `model:${brand}:${model}`;
}
export function merchantProductUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|srsltid|gclid|fbclid|_skw)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return value; }
}
