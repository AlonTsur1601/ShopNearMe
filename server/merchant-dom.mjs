import { load } from "cheerio";

// Read actual product content, not navigation, cart totals or related products.
export function merchantDom(html, baseUrl = "") {
  const $ = load(html);
  $("script,style,nav,header,footer,aside,del,s,.old-price,.price--compare,.related,.related-products,.recommendations,#otherProductsSlider,#products-that-might-interest-you").remove();
  const text = node => node.text().replace(/\s+/g, " ").trim();
  const product = $("#productMainBlock,.product-info-main,.product-detail,#product,[itemtype$='/Product']").first();
  const scope = product.length ? product : $("main").length ? $("main").first() : $("body");
  const descriptions = $("[itemprop='description'],#description,#tab-description,#productInfo,.product-description,.product__description,.product.attribute.description,.woocommerce-product-details__short-description");
  const description = [...new Set(descriptions.map((_i, element) => text($(element))).get())].filter(Boolean).join("\n");
  const metadata = $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || "";
  const bodyText = text(scope);
  const isPrint = /(^|\.)ksp\.co\.il$/i.test(new URL(baseUrl || "https://unknown.example").hostname) && new URL(baseUrl).searchParams.has("print");
  const printTitle = isPrint ? bodyText.match(/שם המוצר\s*:\s*(.+?)(?=מספר מוצר|תאריך תוקף|מחיר אשראי)/)?.[1]?.trim() : "";
  const printPrice = isPrint ? bodyText.match(/מחיר אשראי\s*:\s*([\d,.]+)\s*₪/)?.[1] : undefined;
  let currentPrice;
  for (const selector of ["[data-price-type='finalPrice']", ".special-price .price", "#pricetotalitemjs", "#our_price_display", ".product-price", "[itemprop='price']"]) {
    const element = scope.find(selector).first();
    const amount = element.attr("data-price-amount") || element.attr("content") || text(element);
    // Never concatenate a sale price, instalment count and previous price.
    if (amount && (amount.match(/\d[\d.,]*/g) ?? []).length === 1) { currentPrice = amount; break; }
  }
  const images = [];
  $("#productslider img,.product-gallery img,.product__media img,.product-images img,[itemprop='image'],[data-zoom-image],.fotorama img,.woocommerce-product-gallery img").each((_i, element) => {
    const node = $(element);
    for (const attr of ["data-zoom-image", "data-large-image", "data-src", "content", "src"]) if (node.attr(attr)) images.push(node.attr(attr));
    const srcset = node.attr("srcset") || node.attr("data-srcset");
    if (srcset) images.push(srcset.split(",").at(-1).trim().split(/\s+/)[0]);
  });
  if (isPrint && printTitle) scope.find("img").each((_i, element) => { const src = $(element).attr("src"); if (src && !/logo|banner|icon/i.test(src)) images.push(src); });
  const isCatalog = !product.length && $(".products-grid .product-item,.products.list .product-item,.collection .grid__item,.product-list .product-item").length > 1;
  return { title: printTitle || undefined, currentPrice: printPrice || currentPrice, description: [description, metadata, printTitle ? bodyText : ""].filter(Boolean).join("\n").slice(0, 18000), images, isCatalog, isProduct: !!printTitle || (!!product.length && !!currentPrice && !!scope.find("h1").length), specificationsHtml: descriptions.toArray().map(element => $.html(element)).join("\n") };
}
