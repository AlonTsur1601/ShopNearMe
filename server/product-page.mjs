const pageCache = new Map();
const CACHE_MS = 15 * 60 * 1000;

function numeric(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function webUrl(value) {
  try {
    const parsed = new URL(String(value ?? ""));
    if (!["http:", "https:"].includes(parsed.protocol) || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(parsed.hostname)) return "";
    return parsed.href;
  } catch { return ""; }
}
function meta(html, key) {
  const name = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp('<meta[^>]+(?:property|name)=["\\\']' + name + '["\\\'][^>]+content=["\\\']([^"\\\']+)', "i"))?.[1]
    || html.match(new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']' + name, "i"))?.[1];
}
function products(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((item) => products(item, found)); return found; }
  const type = value["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found.push(value);
  Object.values(value).forEach((item) => products(item, found));
  return found;
}
export function extractProductData(html) {
  const found = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { found.push(...products(JSON.parse(match[1]))); } catch { /* invalid retailer markup */ }
  }
  const product = found[0] ?? {}, offer = Array.isArray(product.offers) ? product.offers[0] : product.offers ?? {};
  const rawImage = Array.isArray(product.image) ? product.image[0] : typeof product.image === "object" ? product.image?.url : product.image;
  const priceText = String(offer.price ?? offer.lowPrice ?? meta(html, "product:price:amount") ?? "");
  return {
    title: product.name || meta(html, "og:title"),
    brand: typeof product.brand === "string" ? product.brand : product.brand?.name,
    imageUrl: webUrl(rawImage || meta(html, "og:image")),
    price: numeric(priceText),
    currency: String(offer.priceCurrency ?? meta(html, "product:price:currency") ?? (/₪|NIS|ILS/i.test(priceText) ? "ILS" : "USD")).toUpperCase(),
  };
}
export async function enrichProductPage(value) {
  const url = webUrl(value);
  if (!url) return {};
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ShopNearMe/1.0 product-price-preview" } });
    if (!response.ok || !String(response.headers?.get?.("content-type") || "").includes("html")) return {};
    const value = extractProductData((await response.text()).slice(0, 750000));
    pageCache.set(url, { at: Date.now(), value });
    return value;
  } catch { return {}; } finally { clearTimeout(timer); }
}
