export default async function handler(_request, response) {
  const urls = {
    bingRss: "https://www.bing.com/search?format=rss&q=wireless%20mouse%20site%3Aivory.co.il",
    brave: "https://search.brave.com/search?q=wireless%20mouse%20site%3Aivory.co.il",
    mojeek: "https://www.mojeek.com/search?q=wireless%20mouse%20site%3Aivory.co.il",
    jinaProduct: "https://r.jina.ai/https://www.ivory.co.il/pulsar-x3-crazylight-medium-wireless-gaming-mouse-black.html",
    ivory: "https://www.ivory.co.il/catalog.php?act=cat&q=wireless%20mouse",
    lastPrice: "https://www.lastprice.co.il/category.asp?q=wireless%20mouse",
  };
  const checks = await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const start = Date.now();
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { "User-Agent": "Mozilla/5.0" } });
      const body = await result.text();
      return { name, status: result.status, ms: Date.now() - start, bytes: body.length, hasProduct: /ivory\.co\.il\/.+\.html|pulsar-x3-crazylight/i.test(body), blocked: /captcha|just a moment|access denied|attention required/i.test(body.slice(0, 4000)) };
    } catch (error) { return { name, error: error.name, ms: Date.now() - start }; }
  }));
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ checks });
}
