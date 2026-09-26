import { afterEach, expect, it, vi } from "vitest";
import { extractProductData, productImageUrl } from "./product-page.mjs";
import { isCategoryPage, isRelevantProduct, matchingShoppingEvidence, searchCatalog } from "./search.mjs";
import { proseAttributes } from "./specifications.mjs";
import { translateTerms } from "./facet-language.mjs";

afterEach(() => vi.unstubAllGlobals());
it("reads Amazon product details and excludes recommendation prices and specifications", () => {
  const html = '<div class="a-price"><span class="a-offscreen">$2.00</span></div><div id="dp-container"><h1 id="productTitle">Desk lamp Black</h1><div id="corePrice_feature_div"><span class="a-price a-text-price"><span class="a-offscreen">$99.00</span></span><span class="a-price"><span class="a-offscreen">$29.95</span></span></div><img id="landingImage" src="https://m.media-amazon.com/lamp.jpg"><div id="feature-bullets">Black Metal lamp.</div><table id="productDetails_techSpec_section_1"><tr><th>Material</th><td>Metal</td></tr><tr><th>Color</th><td>Black</td></tr></table><table><tr><th>Trusted cybersecurity</th><td>Digital security</td></tr></table><div id="sims-recommendations"><table><tr><th>Color</th><td>Pink</td></tr></table></div><div id="availability">Currently unavailable.</div></div>';
  const page = extractProductData(html, "https://www.amazon.com/dp/B012345678");
  expect(page).toMatchObject({ isProduct: true, title: "Desk lamp Black", price: 29.95, imageUrl: "https://m.media-amazon.com/lamp.jpg" });
  expect(page.specifications).toContainEqual(expect.objectContaining({ name: "Material", value: "Metal" }));
  expect(page.specifications).not.toContainEqual(expect.objectContaining({ value: "Pink" }));
  expect(page.specifications).not.toContainEqual(expect.objectContaining({ name: "Trusted cybersecurity" }));
  expect(page.availability).toBe("Out of stock");
});
it("uses the product's price and gallery instead of earlier promotional cards", () => {
  const page = extractProductData('<div class="price">789 ₪</div><img src="/promotion.jpg"><div id="product-page" class="single-product"><h1>Wireless mouse</h1><div class="single-price"><span class="price">99 ₪</span><div id="eilat-price">83 ₪</div></div><div class="single-gallery"><img src="/mouse.jpg"></div><button>Add to cart</button></div>', "https://merchant.co.il/product/mouse");
  expect(page).toMatchObject({ isProduct: true, price: 99, imageUrl: "https://merchant.co.il/mouse.jpg" });
});
it("rejects camping services and accessories instead of using their prices for a tent", () => {
  for (const title of ["Camping complex in private tents", "פנס יד ועששית תאורה לאוהל MINI CREE R2", "Vango Tent Carpet Tigris 600", "Camping Tent Spring Buckle Rope Tensioner"]) expect(isRelevantProduct(title, "camping tent")).toBe(false);
});
it("recognizes a merchant product grid as a catalog, not its first sale price", () => {
  const page = extractProductData('<h1>Camping equipment</h1><div class="products-grid"><div class="product-item">Tent ₪109</div><div class="product-item">Bag ₪49</div></div>', "https://store.co.il/camping.html");
  expect(page.isCatalog).toBe(true);
});
it("does not treat a tent category and its cheapest price as one product", () => {
  expect(isCategoryPage("אוהלים מקצועיים לטיולים, קמפינג וטרקים בכל הגדלים", "https://www.walkin.co.il/16081-%D7%90%D7%95%D7%94%D7%9C%D7%99%D7%9D")).toBe(true);
  expect(isCategoryPage("Camping tent T600", "https://shop.co.il/products/tent-t600")).toBe(false);
});
it("keeps lazy-loaded product images outside named galleries", () => {
  const page = extractProductData('<main><h1>Camping tent T600</h1><img loading="lazy" alt="Camping tent T600" src="/placeholder.png" data-src="/t600.jpg"></main>', "https://store.co.il/t600");
  expect(page.imageUrl).toBe("https://store.co.il/t600.jpg");
});
it("reads nested merchant description, lazy gallery and sale price without related products", () => {
  const html = '<main><h1>Tent T600</h1><div class="special-price"><span class="price">₪299</span></div><div class="old-price">₪499</div><div class="product-description"><p>Green tent for 6 people.</p><div><p>Weight: 4 kg. Width: 240 cm. Waterproof.</p></div></div><div class="product-gallery"><img loading="lazy" src="/placeholder.png" data-src="/tent.webp"></div><div class="related-products"><div class="product-description">Pink bag for 2 people</div></div></main>';
  const page = extractProductData(html, "https://store.co.il/tent");
  expect(page.price).toBe(299);
  expect(page.imageUrl).toBe("https://store.co.il/tent.webp");
  expect(page.specificationText).toContain("6 people");
  expect(page.specificationText).not.toContain("Pink");
  expect(proseAttributes(page.specificationText).attributes).toMatchObject({ capacity: ["6 people"], weight: ["4 kg"], width: ["240 cm"] });
});
it("extracts a public printable KSP product without mistaking its Eilat price for the normal price", () => {
  const page = extractProductData('<body>שם המוצר: ספק כוח MSI MAG A650BN מספר מוצר: 123 תאריך תוקף: היום מחיר אשראי: 370 ₪ מחיר באילת: 313 ₪<img src="/item/123.jpg"><table><tr><td>Power</td><td>650W</td></tr></table></body>', "https://ksp.co.il/?print=123");
  expect(page).toMatchObject({ title: "ספק כוח MSI MAG A650BN", price: 370, imageUrl: "https://ksp.co.il/item/123.jpg", isProduct: true });
});
it("preserves raster product data images but refuses active SVG data", () => {
  expect(productImageUrl("data:image/png;base64,aGVsbG8=")).toBe("data:image/png;base64,aGVsbG8=");
  expect(productImageUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe("");
});
it("only recovers a Shopping price/image for the same model AND merchant", () => {
  const offer = { title: "MSI MAG A650BN PSU", merchant: "Ivory", destinationUrl: "https://www.ivory.co.il/catalog.php?id=1", itemPrice: null, imageUrl: "", currency: "ILS" };
  const item = { title: "ספק MSI A650BN", source: "Ivory", price: "₪370", image: "data:image/png;base64,aGVsbG8=" };
  expect(matchingShoppingEvidence(item, offer)).toMatchObject({ itemPrice: 370, imageUrl: item.image });
  expect(matchingShoppingEvidence({ ...item, source: "KSP" }, offer)).toEqual(offer);
  expect(matchingShoppingEvidence({ ...item, title: "MSI A850GL" }, offer)).toEqual(offer);
});
it("reads affirmative and negative table features from the merchant description", () => {
  expect(proseAttributes(translateTerms("שולחן נפתח עם כיסאות. רוחב: 180 cm")).attributes).toMatchObject({ extendable: ["Yes"], width: ["180 cm"] });
  expect(proseAttributes("Dining table without chairs, non-extendable").attributes).toMatchObject({ chairsIncluded: ["No"], extendable: ["No"] });
});
it("applies merchant description facets and images to both local pickup and delivery offers", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "https://api.brightdata.com/request") {
      const target = new URL(JSON.parse(options.body).url);
      if (target.pathname.startsWith("/maps/")) return new Response(JSON.stringify({ organic: [{ title: "Outdoor Store", link: "https://fixture-shop.co.il/", category: [{ id: "camping_store" }], latitude: 32.08, longitude: 34.88 }] }));
      if (target.searchParams.get("udm") === "28") return new Response('{"shopping":[]}');
      return new Response(JSON.stringify({ organic: [{ title: "Camping tent T600", link: "https://fixture-shop.co.il/products/t600", source: "Outdoor Store", description: "Camping tent for 6 people, green" }] }));
    }
    return new Response('<main><h1>Camping tent T600</h1><meta property="product:price:amount" content="299"><meta property="product:price:currency" content="ILS"><div class="product-description">Green waterproof camping tent for 6 people. Weight: 4 kg.</div><div class="product-gallery"><img data-src="/tent.jpg"></div></main>', { headers: { "content-type": "text/html" } });
  }));
  const result = await searchCatalog("camping tent T600", "Petah Tikva, Israel", { apiKey: "fixture", zone: "merchant-description-test" }, { lat: 32.08, lon: 34.88 });
  expect(result.offers.map(offer => offer.category)).toEqual(["local", "order"]);
  for (const offer of result.offers) {
    expect(offer.itemPrice).toBe(299);
    expect(offer.imageUrl).toBe("https://fixture-shop.co.il/tent.jpg");
    expect(offer.attributes).toMatchObject({ capacity: ["6 people"], weight: ["4 kg"], color: "Green" });
  }
});

it("preserves a model in the page title when structured data names only the product category", () => {
  const page = extractProductData('<meta property="og:title" content="Wireless mouse M171 Logitech"><script type="application/ld+json">{"@type":"Product","name":"Wireless mouse","offers":{"price":49,"priceCurrency":"ILS"},"image":"/mouse.jpg"}</script>', "https://store.example/m171");
  expect(page.title).toBe("Wireless mouse M171 Logitech");
});

it("repairs an absolute CDN image accidentally prefixed by the merchant origin", () => {
  expect(productImageUrl("https://store.example/https://cdn.example/mouse.webp")).toBe("https://cdn.example/mouse.webp");
  expect(productImageUrl("https://store.example/http://127.0.0.1/private")).toBe("");
});
