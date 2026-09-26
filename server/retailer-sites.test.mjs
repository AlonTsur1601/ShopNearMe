import { expect, it } from "vitest";
import { searchRetailerSites } from "./retailer-sites.mjs";
import { duckduckgoProducts } from "./duckduckgo.mjs";

it("uses store product cards and verifies the product page before returning offers", async () => {
  const searches = [];
  const result = await searchRetailerSites({ query: "desk lamp", localizedQuery: "מנורת שולחן", relevant: title => /מנורת שולחן/.test(title), isCatalog: () => false, deadline: Date.now() + 5000 }, {
    fetchPage: async url => {
      searches.push(url);
      const body = url.includes("ivory") ? '<a href="/lamp.html">מנורת שולחן 99₪</a><a href="/category.html">מנורת שולחן</a>' : "";
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    readProduct: async () => ({ isProduct: true, title: "מנורת שולחן", price: 99, currency: "ILS", imageUrl: "https://www.ivory.co.il/lamp.jpg" }),
  });
  expect(searches).toHaveLength(6);
  expect(result.products.map(item => item.link)).toEqual(["https://www.ivory.co.il/lamp.html"]);
});

it("reads ACE's name inside its link and keeps each card's own structured offer", async () => {
  const products = [{ "@type": "Product", name: "Desk lamp Black", url: "https://www.ace.co.il/123456", image: "https://www.ace.co.il/black.jpg", offers: { "@type": "Offer", price: 99, priceCurrency: "ILS" } }, { "@type": "Product", name: "Desk lamp White", url: "https://www.ace.co.il/123457", image: "https://www.ace.co.il/white.jpg", offers: { "@type": "Offer", price: 129, priceCurrency: "ILS", availability: "https://schema.org/OutOfStock" } }];
  const body = `<script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement: products.map(item => ({ "@type": "ListItem", item })) })}</script>${products.map(product => `<div class="product-item"><a href="${product.url}"><strong class="product name product-item-name">${product.name}</strong></a></div>`).join("")}`;
  const result = await searchRetailerSites({ query: "lamp", relevant: title => /lamp/i.test(title), isCatalog: () => false, deadline: Date.now() + 5000 }, {
    fetchPage: async url => new Response(url.includes("ace.co.il") ? body : "", { headers: { "content-type": "text/html" } }), readProduct: async () => ({}),
  });
  expect(result.products).toHaveLength(1);
  expect(result.products[0].page).toMatchObject({ title: "Desk lamp Black", price: 99, imageUrl: "https://www.ace.co.il/black.jpg", priceSource: "catalog" });
});

it("uses the current Amazon card price, canonical ASIN link and original query", async () => {
  let requested;
  const body = '<div data-component-type="s-search-result" data-asin="B012345678"><a href="/dp/B012345678?ref=tracking"><h2>Desk lamp Black</h2></a><img class="s-image" src="https://m.media-amazon.com/lamp.jpg"><span class="a-price a-text-price"><span class="a-offscreen">$89.00</span></span><span class="a-price"><span class="a-offscreen">ILS 55.05</span></span></div>';
  const result = await searchRetailerSites({ query: "desk lamp", country: "US", localizedQuery: "מנורת שולחן", relevant: () => true, isCatalog: () => false, deadline: Date.now() + 5000 }, {
    fetchPage: async url => { requested = url; return new Response(body, { headers: { "content-type": "text/html" } }); }, readProduct: async () => ({}),
  });
  expect(requested).toContain("desk%20lamp");
  expect(result.products).toHaveLength(1);
  expect(result.products[0]).toMatchObject({ link: "https://www.amazon.com/dp/B012345678", page: { price: 55.05, currency: "ILS", localEligible: false } });
});

it("rejects a catalog offer when its product page is deleted or sold out", async () => {
  const body = '<div data-component-type="s-search-result" data-asin="B012345678"><a href="/dp/B012345678"><h2>Lamp</h2></a><img class="s-image" src="https://m.media-amazon.com/lamp.jpg"><span class="a-price"><span class="a-offscreen">$15.00</span></span></div>';
  for (const page of [{ unavailable: true }, { isCatalog: true }, { isProduct: true, availability: "Out of stock" }]) {
    const result = await searchRetailerSites({ query: "lamp", country: "US", relevant: () => true, isCatalog: () => false, deadline: Date.now() + 5000 }, { fetchPage: async () => new Response(body, { headers: { "content-type": "text/html" } }), readProduct: async () => page });
    expect(result.products).toEqual([]);
  }
});

it("uses IKEA's product API without presenting in-store-only products as online purchases", async () => {
  const result = await searchRetailerSites({ query: "lamp", relevant: title => /lamp/i.test(title), isCatalog: () => false, deadline: Date.now() + 5000 }, {
    fetchPage: async (url, options) => {
      if (!url.includes("cdtapps.com")) return new Response("", { headers: { "content-type": "text/html" } });
      expect(JSON.parse(options.body).searchParameters).toEqual({ input: "lamp", type: "QUERY" });
      return Response.json({ results: [{ items: [{ type: "PRODUCT", product: { name: "TEST", typeName: "מנורת שולחן", filterClass: "table lamps", pipUrl: "https://www.ikea.com/il/he/p/test-12345678/", mainImageUrl: "https://www.ikea.com/lamp.jpg", salesPrice: { numeral: 99, currencyCode: "ILS" }, onlineSellable: false, colors: [{ name: "White" }] } }] }] });
    }, readProduct: async () => ({}),
  });
  expect(result.products).toHaveLength(1);
  expect(result.products[0].page).toMatchObject({ brand: "IKEA", price: 99, inStoreOnly: true, localEligible: true, specifications: [{ name: "Color", value: ["White"] }] });
});

it("resolves search redirects to merchant pages", async () => {
  const redirect = "//duckduckgo.com/l/?uddg=" + encodeURIComponent("https://shop.co.il/products/lamp");
  const html = `<div class="result"><a class="result__a" href="${redirect}">Desk lamp</a><div class="result__snippet">₪99</div></div>`;
  const result = await duckduckgoProducts("lamp", "IL", Date.now() + 5000, async () => new Response(html, { headers: { "content-type": "text/html" } }));
  expect(result.organic).toEqual([{ link: "https://shop.co.il/products/lamp", title: "Desk lamp", snippet: "₪99" }]);
});

it("attaches official ACE branches only to products sold by ACE", async () => {
  const branch = '<div class="store-item"><div class="wrap-title"><h2>Test branch</h2><p>ACE</p></div><p>Test address</p><a class="waze" href="https://waze.com/ul?ll=32.06,34.85"></a></div>';
  const card = (id, external) => '<div class="product-item"><a href="https://www.ace.co.il/'+id+'"><strong class="product-item-name">Desk lamp '+id+'</strong></a><img class="product-image-photo" src="https://www.ace.co.il/lamp.jpg"><span data-price-type="finalPrice"><span class="priceNum">99</span></span>'+ (external ? '<span class="external_seller">Partner</span>' : '')+'</div>';
  const result = await searchRetailerSites({ query: "lamp", relevant: title => /lamp/i.test(title), isCatalog: () => false, deadline: Date.now() + 5000 }, {
    fetchPage: async url => new Response(url === "https://www.ace.co.il/stores" ? branch : url.includes("ace.co.il") ? card("123456", false) + card("123457", true) : "", { headers: { "content-type": "text/html" } }), readProduct: async () => ({}),
  });
  expect(result.products.find(item => item.link.endsWith("123456")).page.locations).toEqual([{ name: "Test branch", address: "Test address", lat: 32.06, lon: 34.85 }]);
  expect(result.products.find(item => item.link.endsWith("123457")).page.locations).toBeUndefined();
});
