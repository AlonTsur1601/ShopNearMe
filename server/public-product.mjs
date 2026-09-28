import { budgetFetch } from "./search-budget.mjs";

// Read only public storefront data. No admin credentials, paid proxy or cart mutation.
async function json(url, signal) {
  try {
    const response = await budgetFetch(url, { signal, headers: { Accept: "application/json" } });
    if (!response.ok || response.url && new URL(response.url).origin !== new URL(url).origin) return null;
    const body = await response.text();
    if (body.length > 2000000) return null;
    return JSON.parse(body);
  } catch { return null; }
}

const magentoFields = "__typename sku name url_key url_suffix stock_status description{html} short_description{html} image{url} price_range{minimum_price{final_price{value currency}} maximum_price{final_price{value currency}}}";
export function magentoProduct(item, value) {
  const low = item.price_range?.minimum_price?.final_price, high = item.price_range?.maximum_price?.final_price;
  // A configurable product's cheapest child is not the selected product's price.
  const concrete = item.__typename === "SimpleProduct" && low?.value === high?.value && low?.currency === high?.currency;
  return { "@type": "Product", name: item.name, url: value, image: item.image?.url, description: [item.description?.html, item.short_description?.html].filter(Boolean).join(" "), offers: { ...(concrete ? { price: low.value, priceCurrency: low.currency } : {}), availability: item.stock_status === "OUT_OF_STOCK" ? "https://schema.org/OutOfStock" : undefined } };
}
export function magentoCatalogUrl(origin, query) {
  const url = new URL("/graphql", origin);
  url.searchParams.set("query", `{products(search:${JSON.stringify(query)},pageSize:8){items{${magentoFields}}}}`);
  return url.href;
}

export async function publicProduct(value, html, signal) {
  const url = new URL(value);
  const shopify = url.pathname.match(/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?)(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/i);
  if (shopify) {
    const root = new URL(shopify[1], url), handle = decodeURIComponent(shopify[2]);
    const product = await json(new URL("products/" + encodeURIComponent(handle) + ".js", root).href, signal);
    if (!product?.title || product.handle !== handle || !Array.isArray(product.variants)) return null;
    const selectedId = url.searchParams.get("variant");
    const variant = selectedId ? product.variants.find(item => String(item.id) === selectedId) : product.variants.length === 1 ? product.variants[0] : null;
    if (selectedId && !variant) return null;
    const cart = variant ? await json(new URL("cart.js", root).href, signal) : null;
    const currency = /^[A-Z]{3}$/.test(cart?.currency ?? "") ? cart.currency : undefined;
    const properties = variant ? (product.options ?? []).map((option, index) => ({ name: typeof option === "string" ? option : option.name, value: variant.options?.[index] ?? variant["option" + (index + 1)] })).filter(pair => pair.name && pair.value && pair.value !== "Default Title") : [];
    return {
      "@type": "Product", name: product.title + (variant?.title && variant.title !== "Default Title" ? " — " + variant.title : ""),
      url: value, description: product.description, brand: product.vendor, gtin: variant?.barcode,
      additionalProperty: properties,
      image: variant?.featured_image?.src || product.featured_image || product.images?.[0],
      offers: currency && Number.isFinite(variant?.price) ? { price: variant.price / 100, priceCurrency: currency, availability: variant.available === false ? "https://schema.org/OutOfStock" : undefined } : {},
    };
  }
  if (!/magento|mage\/|Magento_/i.test(html ?? "") && !/(^|\.)officedepot\.co\.il$/i.test(url.hostname)) return null;
  if (url.searchParams.has("variant") || url.searchParams.has("options")) return null;
  const slug = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/\.html$/, "");
  if (!slug) return null;
  const query = `{products(filter:{url_key:{eq:${JSON.stringify(slug)}}}){items{${magentoFields}}}}`;
  const endpoint = new URL("/graphql", url); endpoint.searchParams.set("query", query);
  const data = await json(endpoint.href, signal);
  const items = data?.data?.products?.items;
  if (!Array.isArray(items) || items.length !== 1 || items[0].url_key !== slug) return null;
  return magentoProduct(items[0], value);
}
