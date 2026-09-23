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
  expect(searches).toHaveLength(3);
  expect(result.products.map(item => item.link)).toEqual(["https://www.ivory.co.il/lamp.html"]);
});

it("resolves search redirects to merchant pages", async () => {
  const redirect = "//duckduckgo.com/l/?uddg=" + encodeURIComponent("https://shop.co.il/products/lamp");
  const html = `<div class="result"><a class="result__a" href="${redirect}">Desk lamp</a><div class="result__snippet">₪99</div></div>`;
  const result = await duckduckgoProducts("lamp", "IL", Date.now() + 5000, async () => new Response(html, { headers: { "content-type": "text/html" } }));
  expect(result.organic).toEqual([{ link: "https://shop.co.il/products/lamp", title: "Desk lamp", snippet: "₪99" }]);
});
