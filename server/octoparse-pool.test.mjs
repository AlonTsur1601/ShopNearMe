import { afterEach, expect, it, vi } from "vitest";
import { readPoolTask, reuseOctoparseTask, templateParameters } from "./octoparse-pool.mjs";
import { discoverOctoparseCatalog, productsFromOctoparseHtml, recoverOctoparseSpecifications } from "./octoparse-catalog.mjs";
import { withSearchBudget } from "./search-budget.mjs";

afterEach(() => vi.useRealTimers());
const mapping = JSON.stringify({ TemplateParameters: [{ ParamName: "urls", Value: ["https://merchant.example/product"] }] });
const template = { id: 1, parameters: JSON.stringify([{ Id: "urls-id", ParamName: "urls", DisplayText: "URLs", IsRequired: true }]) };
const product = { "@type": "Product", name: "Studio LED lamp Model L100", image: "https://merchant.example/lamp.jpg", offers: { price: "49.99", priceCurrency: "USD" }, additionalProperty: [{ name: "Color", value: "Red" }] };
const html = item => `<html><body><script type="application/ld+json">${JSON.stringify(item)}</script></body></html>`;
const row = { Original_URL: "https://merchant.example/product", Source_code: html(product) };

it("rejects empty required arrays and accepts the provider's display labels", () => {
  expect(() => templateParameters(template, { URLs: [] })).toThrow();
  expect(() => templateParameters(template, { URLs: [" "] })).toThrow();
  expect(JSON.parse(templateParameters(template, { URLs: ["https://merchant.example/product"] })).TemplateParameters).toEqual(JSON.parse(mapping).TemplateParameters);
});

it("reuses a saved task without creating one and waits for a new exact lot", async () => {
  const request = vi.fn(async path => path.includes("searchTaskList") ? { dataList: [{ taskId: "saved", taskName: "ShopNearMe pool test", templateId: 9001 }] } : { userInputParameters: mapping });
  const call = vi.fn().mockResolvedValueOnce({ status: "completed", lotNo: "939260363630236280" }).mockResolvedValueOnce({ success: true, status: "start_requested" }).mockResolvedValueOnce({ status: "completed", lotNo: "939260363630236280" });
  const started = await reuseOctoparseTask("test", 9001, { URLs: ["https://merchant.example/product"] }, "pool-test-key", { request, call, fetcher: async () => Response.json({ data: template }) });
  expect(started.lotNo).toBeUndefined();
  expect(started.previousLot).toBe("939260363630236280");
  expect(call.mock.calls.map(args => args[0])).toEqual(["get_task_status", "start_or_stop_task"]);
  expect(request.mock.calls.some(args => /executeTask|createTask/.test(args[0]))).toBe(false);
});

it("defers a new phase before its deadline and starts it once on continuation", async () => {
  const start = vi.fn(async () => ({ taskId: "deferred-test", status: "pending", nextPollAt: Date.now() + 15000 }));
  const read = vi.fn(async task => ({ ...task, status: "empty", rows: [] }));
  const options = { query: "deadline product", country: "IL", relevant: () => true, config: { octoparseApiKey: "deadline-test" } };
  const first = await withSearchBudget(() => discoverOctoparseCatalog(options, { start, read }), 1000);
  expect(first.continuation).toBeTruthy();
  expect(start).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  await withSearchBudget(() => discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read }));
  expect(start.mock.calls.filter(args => args[0] === "amazon-classic" && args[1] === 1153)).toHaveLength(1);
  expect(start.mock.calls.filter(args => args[0] === "marketplace")).toHaveLength(1);
});

it("waits for an occupied shared pool slot and resumes without reporting a final failure", async () => {
  let busy = true, serial = 0;
  const start = vi.fn(async role => {
    if (role === "amazon-classic" && busy) throw Object.assign(new Error("Occupied"), { code: "provider_busy" });
    return { taskId: String(++serial), status: "pending" };
  });
  const read = async task => ({ ...task, status: "empty", rows: [] });
  const options = { query: "busy-slot lamp", country: "US", relevant: () => true, config: { octoparseApiKey: "busy-slot-test" } };
  const first = await discoverOctoparseCatalog(options, { start, read });
  expect(first.continuation).toBeTruthy();
  expect(first.sourceStatus.find(source => source.source === "amazon via Octoparse")).toMatchObject({ status: "pending" });
  busy = false;
  const result = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(result.continuation).toBeUndefined();
  expect(result.sourceStatus.find(source => source.source === "amazon via Octoparse")).toMatchObject({ status: "empty" });
});

it("exports small pages in order without rounding the run identity", async () => {
  const call = vi.fn(async (_name, args) => ({ success: true, data: Array.from({ length: Math.min(5, 12 - (args.page - 1) * 5) }, (_, i) => ({ n: (args.page - 1) * 5 + i })) }));
  const result = await readPoolTask({ taskId: "paged", lotNo: "939260363630236283", status: "completed", collectedRows: 12 }, "key", { call });
  expect(result.rows.map(row => row.n)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(call.mock.calls.map(args => args[1])).toEqual([1,2,3].map(page => ({ taskId: "paged", lotNo: "939260363630236283", page, pageSize: 5 })));
});

it("rejects missing export rows and oversized datasets instead of reporting success", async () => {
  const call = vi.fn(async () => ({ success: true, data: [{ n: 1 }] }));
  await expect(readPoolTask({ taskId: "short-export", lotNo: "939260363630236284", status: "completed", collectedRows: 2 }, "key", { call })).rejects.toMatchObject({ code: "incomplete_export" });
  call.mockClear();
  await expect(readPoolTask({ taskId: "oversized-export", lotNo: "939260363630236285", status: "completed", collectedRows: 101 }, "key", { call })).rejects.toMatchObject({ code: "incomplete_export" });
  expect(call).not.toHaveBeenCalled();
});

it("reports omitted requested pages while retaining the real products that were returned", async () => {
  let serial = 0;
  const start = async (role, _template, values) => ({ taskId: String(++serial), lotNo: String(serial), role, values, status: "pending" });
  const read = async task => ({ ...task, status: "completed", rows: task.role === "pages" ? [row] : [] });
  const result = await discoverOctoparseCatalog({ query: "omitted lamp", country: "IL", relevant: () => true, config: { octoparseApiKey: "omitted-page-test" } }, { start, read });
  expect(result.products).toHaveLength(1);
  expect(result.sourceStatus).toEqual(expect.arrayContaining([expect.objectContaining({ status: "failed", code: "incomplete_retrieval" })]));
});

it("does not offer a collection page as an individually priced product", () => {
  const result = productsFromOctoparseHtml([{ ...row, Source_code: html({ "@graph": [product, { "@type": "CollectionPage" }] }) }], () => true, "lamp");
  expect(result.products).toEqual([]);
});

it("reads fractional superscripts and skips cards with missing destinations", () => {
  const source = html({ ...product, offers: { price: "599.90", priceCurrency: "ILS" } }).replace("</body>", '<div class="product-price"><strong>599<sup>90 ₪</sup></strong></div><div class="product-card"><h3>Another lamp</h3><img src="/other.jpg"><span class="price">₪40</span></div></body>');
  const result = productsFromOctoparseHtml([{ ...row, Source_code: source }], () => true, "lamp");
  expect(result.products).toHaveLength(1);
  expect(result.products[0].page.price).toBe(599.90);
  expect(result.candidates.some(link => link.endsWith("/undefined"))).toBe(false);
});

it("resumes on a cold worker without exporting previously parsed HTML again", async () => {
  let serial = 0;
  const start = vi.fn(async (role, _id, values) => ({ taskId: String(++serial), lotNo: String(serial), role, values, status: "pending" }));
  let branchesReady = false;
  const read = vi.fn(async task => {
    if (task.role === "branches" && !branchesReady) return { ...task, rows: [], status: "pending" };
    const rows = task.role === "retail" ? [{ Detail_URL: row.Original_URL }]
      : task.role === "pages" && task.values["URLs (up to 10,000 per run)"].includes(row.Original_URL) ? [row] : [];
    return { ...task, status: rows.length ? "completed" : "empty", rows };
  });
  const options = { query: "cold-worker lamp", country: "IL", nearbyQuery: "cold-worker city", nearbyLocation: "City", relevant: () => true, config: { octoparseApiKey: "cold-worker-key" } };
  const first = await discoverOctoparseCatalog(options, { start, read });
  expect(first.products).toHaveLength(1); expect(first.continuation).toBeTruthy();
  const payload = JSON.parse(Buffer.from(first.continuation.split(".")[0], "base64url").toString());
  expect(payload.task.pages.snapshot.products).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain("Source_code");
  const reads = read.mock.calls.length;
  branchesReady = true;
  vi.resetModules();
  const cold = await import("./octoparse-catalog.mjs");
  const result = await cold.discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(result.products).toHaveLength(1); expect(result.continuation).toBeUndefined();
  expect(read.mock.calls.slice(reads).map(([task]) => task.role)).toEqual(["branches"]);
});

it("exports signed historical lots without reading another query's current task", async () => {
  const request = vi.fn(), call = vi.fn(async () => ({ success: true, data: [row] }));
  const state = await readPoolTask({ taskId: "saved", lotNo: "939260363630236281", status: "completed", collectedRows: 1 }, "key", { request, call });
  expect(state.rows).toEqual([row]); expect(request).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledWith("export_data", { taskId: "saved", lotNo: "939260363630236281", page: 1, pageSize: 5 }, "key");
});

it("rejects reassigned input before exporting or stopping anyone else's run", async () => {
  const call = vi.fn();
  await expect(readPoolTask({ taskId: "saved", lotNo: "939260363630236281", status: "pending", inputHash: "other-query" }, "key", { request: async () => ({ userInputParameters: mapping }), call })).rejects.toMatchObject({ code: "task_reassigned" });
  expect(call).not.toHaveBeenCalled();
});

it("polls pending empty rows again and discovers branches after product-page discovery", async () => {
  vi.useFakeTimers();
  let serial = 0;
  const starts = vi.fn(async (role, _template, values) => ({ taskId: String(++serial), lotNo: String(serial), role, values, status: "pending" }));
  const read = vi.fn(async task => {
    if (Date.now() < 20000) return { ...task, rows: [], status: "pending", nextPollAt: 20000 };
    const rows = task.role === "retail" ? [{ Detail_URL: row.Original_URL }]
      : task.role === "branches" ? [{ Title: "Merchant", Website: "https://merchant.example", Latitude: "32.0", Longitude: "34.9" }]
      : task.role === "pages" && task.values["URLs (up to 10,000 per run)"].includes(row.Original_URL) ? [row] : [];
    return { ...task, status: rows.length ? "completed" : "empty", rows };
  });
  vi.setSystemTime(10000);
  const options = { query: "Studio lamp", country: "IL", nearbyQuery: "Studio lamp city", nearbyLocation: "City, Israel", relevant: () => true, config: { octoparseApiKey: "pending-coverage-key" } };
  const first = await discoverOctoparseCatalog(options, { start: starts, read });
  expect(first.continuation).toBeTruthy(); expect(first.products).toEqual([]);
  vi.setSystemTime(21000);
  const result = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start: starts, read });
  expect(result.products).toHaveLength(1); expect(result.places).toHaveLength(1);
  expect(result.continuation).toBeUndefined();
  expect(starts.mock.calls.filter(args => args[0] === "amazon-classic" && args[1] === 1153)).toHaveLength(1);
  expect(starts.mock.calls.some(args => args[0] === "branches")).toBe(true);
});

it("parses product cards using their own prices and ignores captcha code in real pages", () => {
  const source = `<script>const captchaEnabled=true</script><main><div class="product-item"><a class="product-item-link" href="/lamp">Red lamp</a><img class="product-image-photo" src="/lamp.jpg"><span itemprop="priceCurrency" content="USD"></span><span itemprop="price" content="40">$40</span></div><div class="product-item"><a class="product-item-link" href="/missing">Blue lamp</a><img class="product-image-photo" src="/blue.jpg"></div></main>`;
  const result = productsFromOctoparseHtml([{ Original_URL: "https://merchant.example/search", Source_code: source }], () => true, "lamp");
  expect(result.blocked).toEqual([]); expect(result.products).toHaveLength(1);
  expect(result.products[0].page).toMatchObject({ price: 40, currency: "USD", imageUrl: "https://merchant.example/lamp.jpg" });
  expect(productsFromOctoparseHtml([{ Original_URL: row.Original_URL, Source_code: "<body>Access denied. Verify you are human.</body>" }], () => true, "lamp").blocked).toEqual([row.Original_URL]);
  expect(productsFromOctoparseHtml([{ Original_URL: row.Original_URL, Source_code: "<title>Error Page | eBay</title><body>Something went wrong</body>" }], () => true, "lamp").blocked).toEqual([row.Original_URL]);
});

it("keeps retailer-published addresses and excludes incidental store words in category names", () => {
  const source = '<article class="store-item"><h2>Tel Aviv branch</h2><address>32 Kibbutz Galuyot, Tel Aviv</address></article><a href="/transistors">Transistors</a><a href="/branches">Our stores</a>';
  const result = productsFromOctoparseHtml([{ ...row, Source_code: source }], () => true, "lamp");
  expect(result.locations.get("merchant.example")).toEqual([{ address: "32 Kibbutz Galuyot, Tel Aviv", name: "Tel Aviv branch" }]);
  expect(result.branchUrls).toEqual(["https://merchant.example/branches"]);
});

it("recovers real specifications for the same model without copying another variant or its price", () => {
  const products = productsFromOctoparseHtml([row], () => true, "lamp").products;
  const pages = productsFromOctoparseHtml([{ ...row, Original_URL: "https://manufacturer.example/l100", Source_code: html({ ...product, offers: undefined, additionalProperty: [{ name: "Material", value: "Aluminium" }] }) }, { ...row, Original_URL: "https://manufacturer.example/l200", Source_code: html({ ...product, name: "Studio LED lamp Model L200", additionalProperty: [{ name: "Material", value: "Plastic" }] }) }], () => true, "lamp");
  const recovered = recoverOctoparseSpecifications(products, pages);
  expect(recovered[0].page.price).toBe(49.99);
  expect(recovered[0].page.specifications).toContainEqual(expect.objectContaining({ name: "Material", value: "Aluminium" }));
  expect(recovered[0].page.specifications).not.toContainEqual(expect.objectContaining({ value: "Plastic" }));
});
