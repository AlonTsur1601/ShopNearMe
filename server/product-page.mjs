const pageCache = new Map();
const CACHE_MS = 15 * 60 * 1000;

function numeric(value) {
  let normalized = String(value ?? "").replace(/\s|\u00a0/g, "").replace(/[^0-9.,]/g, "");
  const comma = normalized.lastIndexOf(","), dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    normalized = normalized.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  } else if (comma >= 0) {
    normalized = /,\d{1,2}$/.test(normalized) ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if ((normalized.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(normalized)) normalized = normalized.replace(/\./g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function decode(value) { return String(value ?? "").replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/\\\//g, "/").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'"); }
function webUrl(value, baseUrl = "") {
  try {
    const parsed = new URL(decode(value), baseUrl || undefined);
    if (!["http:", "https:"].includes(parsed.protocol) || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(parsed.hostname)) return "";
    return parsed.href;
  } catch { return ""; }
}
function meta(html, key) {
  const name = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp('<meta[^>]+(?:property|name)=["\\\']' + name + '["\\\'][^>]+content=["\\\']([^"\\\']+)', "i"))?.[1]
    || html.match(new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']' + name, "i"))?.[1];
}
function attributeValue(html, attribute, name, valueAttributes = ["content", "value", "src", "href"]) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+${attribute}=["']${escaped}["'][^>]*>`, "i"))?.[0];
  if (!tag) return undefined;
  for (const valueAttribute of valueAttributes) {
    const match = tag.match(new RegExp(`${valueAttribute}=["']([^"']+)`, "i"));
    if (match) return decode(match[1]);
  }
}
function products(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((item) => products(item, found)); return found; }
  const type = value["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found.push(value);
  Object.values(value).forEach((item) => products(item, found));
  return found;
}
function imageValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.url || value.contentUrl || value.src || "";
}
function firstPrice(...values) {
  for (const value of values) { const parsed = numeric(value); if (parsed !== null && parsed > 0) return parsed; }
  return null;
}
export function extractProductData(html, baseUrl = "") {
  const found = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { found.push(...products(JSON.parse(match[1]))); } catch { /* invalid retailer markup */ }
  }
  const product = found.find((item) => item.offers || item.image) ?? found[0] ?? {};
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers ?? {};
  const specification = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification ?? {};
  const rawImage = imageValue(Array.isArray(product.image) ? product.image[0] : product.image)
    || imageValue(product.primaryImageOfPage)
    || meta(html, "og:image") || meta(html, "twitter:image")
    || attributeValue(html, "itemprop", "image");
  const metaPrice = meta(html, "product:price:amount") || meta(html, "og:price:amount") || attributeValue(html, "itemprop", "price");
  const dataPrice = html.match(/\bdata-(?:product-)?price=["']([^"']+)/i)?.[1];
  const jsonPrice = html.match(/["'](?:salePrice|currentPrice|price)["']\s*:\s*["']?([0-9][0-9.,]*)/i)?.[1];
  const visiblePrice = html.match(/(?:₪|NIS|ILS)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:₪|NIS|ILS)|(?:\$|USD)\s*([0-9][0-9.,]*)|(?:€|EUR)\s*([0-9][0-9.,]*)|(?:£|GBP)\s*([0-9][0-9.,]*)/i);
  const price = firstPrice(offer.price, offer.lowPrice, specification.price, specification.minPrice, metaPrice, dataPrice, jsonPrice, visiblePrice?.slice(1).find(Boolean));
  const currencyText = String(offer.priceCurrency ?? specification.priceCurrency ?? meta(html, "product:price:currency") ?? meta(html, "og:price:currency") ?? attributeValue(html, "itemprop", "priceCurrency") ?? "");
  const currency = currencyText.match(/\b(ILS|USD|EUR|GBP|CAD|AUD|JPY|CHF|SEK|NOK|DKK|PLN|CZK|NZD)\b/i)?.[1]
    || (/₪|NIS|ILS/i.test(visiblePrice?.[0] ?? "") ? "ILS" : /€|EUR/i.test(visiblePrice?.[0] ?? "") ? "EUR" : /£|GBP/i.test(visiblePrice?.[0] ?? "") ? "GBP" : /\$|USD/i.test(visiblePrice?.[0] ?? "") ? "USD" : "USD");
  return {
    title: product.name || meta(html, "og:title"),
    brand: typeof product.brand === "string" ? product.brand : product.brand?.name,
    imageUrl: webUrl(rawImage, baseUrl),
    price,
    currency: String(currency).toUpperCase(),
  };
}
export async function enrichProductPage(value) {
  const url = webUrl(value);
  if (!url) return {};
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const controller = new AbortController();
  let timer;
  const request = (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" } });
      if (!response.ok || !String(response.headers?.get?.("content-type") || "").includes("html")) return {};
      const result = extractProductData((await response.text()).slice(0, 2000000), response.url || url);
      pageCache.set(url, { at: Date.now(), value: result });
      return result;
    } catch { return {}; }
  })();
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve({}); }, 5500); });
  try { return await Promise.race([request, timeout]); } finally { clearTimeout(timer); }
}
