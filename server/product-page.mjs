import { extractNamedSpecifications } from "./specifications.mjs";
const pageCache = new Map();
const pageRequests = new Map();
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
  if (!value || !String(value).trim()) return "";
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
function sameProductUrl(left, right) {
  try { const a = new URL(left, right), b = new URL(right); return a.origin === b.origin && a.pathname === b.pathname && ["id", "item", "proid"].every(key => a.searchParams.get(key) === b.searchParams.get(key)); } catch { return false; }
}
function mainProducts(root) {
  if (Array.isArray(root)) return root.flatMap(mainProducts);
  if (!root || typeof root !== "object") return [];
  const type = [root["@type"]].flat();
  if (type.includes("Product")) return [root];
  return [...mainProducts(root.mainEntity), ...mainProducts(root["@graph"])];
}
function embeddedProducts(value, found = [], key = "", budget = { remaining: 3000 }) {
  if (!value || typeof value !== "object" || budget.remaining-- <= 0) return found;
  if (/related|recommend|upsell|cross.?sell|cart/i.test(key)) return found;
  const name = value.name ?? value.title ?? value.productName, amount = value.currentPrice ?? value.salePrice ?? value.price;
  if (/^(product|productData|productDetails|item)$/i.test(key) && name && amount != null) {
    const currency = amount.currency ?? amount.currencyCode ?? value.currency ?? value.priceCurrency;
    // Currency is required: unlabelled integers could be minor currency units.
    if (currency) found.push({ ...value, name, offers: { price: amount.value ?? amount.amount ?? amount, priceCurrency: currency } });
  }
  for (const [childKey, child] of Object.entries(value)) if (child && typeof child === "object") embeddedProducts(child, found, childKey, budget);
  return found;
}
function htmlScope(html) {
  const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return body.split(/<(?:section|div)\b[^>]*(?:class|id)=["'][^"']*(?:related-products|recommendations|recently-viewed|upsells|cross-sells)/i)[0]
    .replace(/<(?:script|style|del|s)\b[^>]*>[\s\S]*?<\/(?:script|style|del|s)>/gi, "");
}
function productImages(html, product, title, baseUrl) {
  const candidates = [...[product.image ?? []].flat(), product.primaryImageOfPage, meta(html, "og:image"), meta(html, "twitter:image"), attributeValue(html, "itemprop", "image")].map(imageValue);
  for (const match of htmlScope(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0], alt = tag.match(/\balt=["']([^"']*)/i)?.[1] ?? "";
    if (/logo|favicon|banner|avatar|payment|placeholder|loading|sprite/i.test(tag)) continue;
    const words = String(title ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (!/product|gallery|itemprop=["']image/i.test(tag) && !words.some(w => alt.toLowerCase().includes(w))) continue;
    candidates.push(tag.match(/\bdata-src=["']([^"']+)/i)?.[1], tag.match(/\bsrc=["']([^"']+)/i)?.[1]);
  }
  return [...new Set(candidates.map(value => webUrl(value, baseUrl)).filter(url => url && !sameProductUrl(url, baseUrl) && !/logo|favicon|placeholder|\.svg(?:\?|$)/i.test(url)))];
}
export function extractProductData(html, baseUrl = "") {
  const found = [], primary = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const root = JSON.parse(match[1]); found.push(...products(root)); primary.push(...mainProducts(root)); } catch { /* invalid retailer markup */ }
  }
  if (!primary.length) for (const match of html.matchAll(/<script\b[^>]*(?:type=["']application\/json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { primary.push(...embeddedProducts(JSON.parse(match[1]))); } catch { /* invalid embedded data */ }
  }
  const product = found.find(item => item.url && sameProductUrl(item.url, baseUrl)) ?? primary.find(item => item.offers || item.image) ?? primary[0] ?? (found.length === 1 ? found[0] : {});
  const title = product.name || meta(html, "og:title") || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, " ").trim();
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers ?? {};
  const specification = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification ?? {};
  const imageUrls = productImages(html, product, title, baseUrl);
  const scope = htmlScope(html);
  const metaPrice = meta(html, "product:price:amount") || meta(html, "og:price:amount") || attributeValue(html, "itemprop", "price");
  const dataPrice = scope.match(/\bdata-(?:product-)?price=["']([^"']+)/i)?.[1];
  const priceMarkup = scope.match(/<([a-z][\w-]*)\b[^>]*(?:class|id)=["'][^"']*(?:product-price|current-price|sale-price|price)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const priceText = decode((priceMarkup ?? "").replace(/<[^>]*>/g, " ")).replace(/&nbsp;|&#160;/gi, " ");
  const visiblePrice = priceText.match(/(?:₪|NIS|ILS|ש["״]ח)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:₪|NIS|ILS|ש["״]ח)|(?:\$|USD)\s*([0-9][0-9.,]*)|(?:€|EUR)\s*([0-9][0-9.,]*)|(?:£|GBP)\s*([0-9][0-9.,]*)/i);
  const price = firstPrice(offer.price, offer.lowPrice, specification.price, specification.minPrice, metaPrice, dataPrice, visiblePrice?.slice(1).find(Boolean), /^\s*[\d.,]+\s*$/.test(priceText) ? priceText : null);
  const currencyText = String(offer.priceCurrency ?? specification.priceCurrency ?? meta(html, "product:price:currency") ?? meta(html, "og:price:currency") ?? attributeValue(html, "itemprop", "priceCurrency") ?? "");
  const currency = currencyText.match(/\b(ILS|USD|EUR|GBP|CAD|AUD|JPY|CHF|SEK|NOK|DKK|PLN|CZK|NZD)\b/i)?.[1]
    || (/₪|NIS|ILS|ש["״]ח/i.test(visiblePrice?.[0] ?? "") ? "ILS" : /€|EUR/i.test(visiblePrice?.[0] ?? "") ? "EUR" : /£|GBP/i.test(visiblePrice?.[0] ?? "") ? "GBP" : /\$|USD/i.test(visiblePrice?.[0] ?? "") ? "USD" : /\.il$/i.test(new URL(baseUrl || "https://unknown.example").hostname) ? "ILS" : "USD");
  return {
    isCatalog: !product.name && (found.length > 1 || /["']@type["']\s*:\s*["']ItemList["']/i.test(html)),
    isProduct: !!product.name || !!metaPrice || /(?:add.to.cart|הוסף.{0,12}לסל|הוספה.{0,12}לסל)/i.test(scope),
    title,
    gtin: String(product.gtin ?? product.gtin13 ?? product.gtin14 ?? product.gtin12 ?? product.gtin8 ?? "").trim(),
    brand: typeof product.brand === "string" ? product.brand : product.brand?.name,
    specifications: extractNamedSpecifications(scope, product),
    specificationText: [product.description, ...[product.additionalProperty ?? []].flat().map((property) => `${property.name ?? ""} ${property.value ?? ""} ${property.unitText ?? ""}`)].filter(Boolean).join(" ").replace(/<[^>]*>/g, " ").slice(0, 12000),
    imageUrl: imageUrls[0] ?? "",
    imageUrls,
    price,
    currency: String(currency).toUpperCase(),
  };
}
export async function readProductHtml(response) {
  if (!response.arrayBuffer) return response.text();
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hint = new TextDecoder("ascii").decode(bytes.slice(0, 8192));
  const charset = response.headers.get("content-type")?.match(/charset=["']?([\w-]+)/i)?.[1] ?? hint.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}
export async function enrichProductPage(value) {
  const url = webUrl(value);
  if (!url) return {};
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (pageRequests.has(url)) return pageRequests.get(url);
  const controller = new AbortController();
  let timer;
  const request = (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" } });
      if (!response.ok || !String(response.headers?.get?.("content-type") || "").includes("html")) return {};
      const result = extractProductData((await readProductHtml(response)).slice(0, 2000000), response.url || url);
      pageCache.set(url, { at: Date.now(), value: result });
      return result;
    } catch { return {}; }
  })();
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve({}); }, 5500); });
  const pending = Promise.race([request, timeout]).finally(() => { clearTimeout(timer); pageRequests.delete(url); });
  pageRequests.set(url, pending);
  return pending;
}
