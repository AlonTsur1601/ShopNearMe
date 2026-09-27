import { afterEach, expect, it, vi } from "vitest";
import { readPoolTask, reuseOctoparseTask, templateParameters } from "./octoparse-pool.mjs";
import { discoverOctoparseCatalog, merchantBalancedLinks, persistOctoparseLocations, productsFromOctoparseHtml, recoverOctoparseContent, recoverOctoparseSpecifications } from "./octoparse-catalog.mjs";
import { withSearchBudget } from "./search-budget.mjs";
import { readContinuation } from "./octoparse-discovery.mjs";

afterEach(() => vi.useRealTimers());
const mapping = JSON.stringify({ TemplateParameters: [{ ParamName: "urls", Value: ["https://merchant.example/product"] }] });
const template = { id: 1, parameters: JSON.stringify([{ Id: "urls-id", ParamName: "urls", DisplayText: "URLs", IsRequired: true }]) };
const product = { "@type": "Product", name: "Studio LED lamp Model L100", image: "https://merchant.example/lamp.jpg", offers: { price: "49.99", priceCurrency: "USD" }, additionalProperty: [{ name: "Color", value: "Red" }] };
const html = item => `<html><body><script type="application/ld+json">${JSON.stringify(item)}</script></body></html>`;
const row = { Original_URL: "https://merchant.example/product", Source_code: html(product) };

it("keeps content facts attached to the exact product URL and identity", () => {
  const items = [{ link: row.Original_URL, title: product.name, page: {} }];
  const rows = [{ url: row.Original_URL, title: product.name, format: "markdown", content: '- Color: White\n- Material: Metal' }, { url: row.Original_URL, title: 'Other lamp Model L200', content: '- Color: Blue' }];
  expect(recoverOctoparseContent(items, rows)[0].page.specifications).toEqual([{ name: "Color", value: "White" }, { name: "Material", value: "Metal" }]);
});

it("keeps every merchant in the page budget and deduplicates navigation fragments", () => {
  const links = [...Array.from({ length: 12 }, (_, i) => `https://first.example/products/${i}`), "https://second.example/branches#main", "https://second.example/branches#", "https://third.example/product?srsltid=tracking"];
  expect(merchantBalancedLinks(links, 4)).toEqual(["https://first.example/products/0", "https://second.example/branches", "https://third.example/product", "https://first.example/products/1"]);
  expect(merchantBalancedLinks(["https://shop.example/product?id=123", "https://shop.example/product?id=456"], 2)).toHaveLength(2);
});

it("recovers address navigation targets and deduplicates coordinates", () => {
  const source = '<a href="https://waze.com/ul?q=32%20Main%20St%2C%20City">Directions</a><a href="https://www.google.com/maps/search/?query=32%20Main%20St%2C%20City">Map</a><a href="https://waze.com/ul?ll=32.06,34.85">Coordinates</a><a href="https://waze.com/ul?ll=32.06,34.85">Duplicate</a>';
  const found = productsFromOctoparseHtml([{ Original_URL: "https://merchant.example/branches#main", Source_code: source }], () => true, "lamp");
  expect(found.locations.get("merchant.example")).toEqual([{ address: "32 Main St, City", name: "" }, { lat: 32.06, lon: 34.85, address: "", name: "" }]);
  expect(found.products).toEqual([]);
});

it("reads linked product cards and split currency amounts without borrowing another card's price", () => {
  const source = '<a class="product_box" href="/product/lamp-a" title="Table lamp A"><img src="/a.jpg"><h2>Table lamp A</h2><span class="woocommerce-Price-amount">₪998</span></a><div class="ty-grid-list__item"><a class="product-title" href="/product/lamp-b">Table lamp B</a><img src="/b.jpg"><span class="ty-price"><span class="ty-price-num">₪</span><span class="ty-price-num">49,00</span></span><span class="ty-list-price">₪89,00</span></div><product-card class="card--product"><a href="/products/lamp-c" aria-label="Table lamp C"><img src="/c.jpg"></a><strong class="price__current">599<sup>90 ₪</sup></strong></product-card><a class="product_box" href="/product/no-price" title="Table lamp without price"><img src="/d.jpg"></a>';
  const result = productsFromOctoparseHtml([{ Original_URL: "https://shop.example/catalog", Source_code: source }], () => true, "lamp");
  expect(result.products.map(item => ({ link: item.link, price: item.page.price, currency: item.page.currency }))).toEqual([
    { link: "https://shop.example/product/lamp-a", price: 998, currency: "ILS" },
    { link: "https://shop.example/product/lamp-b", price: 49, currency: "ILS" },
    { link: "https://shop.example/products/lamp-c", price: 599.9, currency: "ILS" },
  ]);
});

it("preserves each card's named facts and variant without borrowing category or sibling metadata", () => {
  const metadata = JSON.stringify({ name: 'Studio table lamp', brand: 'Maker', material: 'Metal', color: 'White', designer: 'Designer', id: '123', position: 1 });
  const source = `<section data-params='${metadata}'><a class="product_box" href="/collections/blue/products/studio-lamp-white"><h2>Studio table lamp</h2><img src="/a.jpg" alt="Studio table lamp White"><span class="price">$40</span></a></section><a class="product_box" href="/products/other-lamp"><h2>Other table lamp</h2><img src="/b.jpg"><span class="price">$50</span></a>`;
  const result = productsFromOctoparseHtml([{ Original_URL: 'https://shop.example/catalog', Source_code: source }], () => true, 'lamp');
  expect(result.products[0].page.specifications).toEqual([{ name: 'brand', value: 'Maker' }, { name: 'material', value: 'Metal' }, { name: 'color', value: 'White' }, { name: 'designer', value: 'Designer' }]);
  expect(result.products[0].page.specificationText).toContain('studio lamp white');
  expect(result.products[0].page.specificationText).not.toContain('blue');
  expect(result.products[1].page.specifications).toEqual([]);
});

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
  vi.useFakeTimers();
  const start = vi.fn(async () => ({ taskId: "deferred-test", status: "pending", nextPollAt: Date.now() + 15000 }));
  const read = vi.fn(async task => ({ ...task, status: "empty", rows: [] }));
  const options = { query: "deadline product", country: "IL", relevant: () => true, config: { octoparseApiKey: "deadline-test" } };
  const first = await withSearchBudget(() => discoverOctoparseCatalog(options, { start, read }), 1000);
  expect(first.continuation).toBeTruthy();
  expect(start).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  vi.setSystemTime(first.nextPollAt + 1);
  await withSearchBudget(() => discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read }));
  expect(start.mock.calls.filter(args => args[0] === "amazon-classic" && args[1] === 1153)).toHaveLength(1);
  expect(start.mock.calls.filter(args => args[0] === "marketplace")).toHaveLength(1);
});

it("waits for an occupied shared pool slot and resumes without reporting a final failure", async () => {
  vi.useFakeTimers();
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
  const early = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(start.mock.calls.filter(args => args[0] === "amazon-classic")).toHaveLength(1);
  vi.setSystemTime(early.nextPollAt + 1);
  const result = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(result.continuation).toBeUndefined();
  expect(result.sourceStatus.find(source => source.source === "amazon via Octoparse")).toMatchObject({ status: "empty" });
});

it("resumes an accepted start after an acknowledgement timeout without starting another run", async () => {
  vi.useFakeTimers();
  let accepted = false;
  const request = vi.fn(async path => path.includes("searchTaskList")
    ? { dataList: [{ taskId: "accepted-start", taskName: "ShopNearMe pool amazon-classic", templateId: 9002 }] }
    : { userInputParameters: mapping });
  const call = vi.fn(async name => {
    if (name === "start_or_stop_task") { accepted = true; throw Object.assign(new Error("Acknowledgement timeout"), { name: "AbortError" }); }
    return { status: accepted ? "running" : "completed", lotNo: accepted ? "939260363630236299" : "939260363630236298" };
  });
  const start = async role => role === "amazon-classic"
    ? reuseOctoparseTask(role, 9002, { URLs: ["https://merchant.example/product"] }, "accepted-start-test", { request, call, fetcher: async () => Response.json({ data: template }) })
    : { status: "empty", rows: [] };
  const read = vi.fn(async task => ({ ...task, status: "empty", rows: [] }));
  const options = { query: "accepted-start lamp", country: "US", relevant: () => true, config: { octoparseApiKey: "accepted-start-test" } };
  const first = await discoverOctoparseCatalog(options, { start, read });
  expect(first.sourceStatus.find(source => source.source === "amazon via Octoparse").status).toBe("pending");
  vi.setSystemTime(first.nextPollAt + 1);
  const resumed = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(resumed.continuation).toBeUndefined();
  expect(call.mock.calls.filter(args => args[0] === "start_or_stop_task")).toHaveLength(1);
  expect(read.mock.calls.some(args => args[0].lotNo === "939260363630236299")).toBe(true);
});

it("recovers source-page specifications beyond a full hundred-record batch", async () => {
  let serial = 0;
  const start = vi.fn(async (role, _id, values) => ({ taskId: String(++serial), status: "pending", role, values }));
  const read = async task => ({ ...task, status: "completed", rows: task.role === "amazon-classic"
    ? Array.from({ length: 101 }, (_, index) => ({ Product_URL_clean: `https://www.amazon.com/dp/B${String(index).padStart(9,"0")}`, Product_name: "Studio lamp", Image_link: "https://images.example/lamp.jpg", Current_price: "$40" }))
    : task.role === "content" ? task.values.MainKeys.map(link => ({ url: link, title: "Studio lamp", content: "Source-backed specification details" })) : [] });
  const result = await discoverOctoparseCatalog({ query: "all-products lamp", country: "US", relevant: () => true, specificationRequests: () => ["missing specifications"], config: { octoparseApiKey: "all-product-content-test" } }, { start, read });
  expect(result.products).toHaveLength(101);
  expect(result.products.every(product => product.page.specificationText.includes("Source-backed specification details"))).toBe(true);
  expect(start.mock.calls.filter(args => args[0] === "content").map(args => args[2].MainKeys.length)).toEqual([100,1]);
});

it("recovers product facts while branch lookup is pending and searches only unresolved facts", async () => {
  let serial = 0;
  const start = vi.fn(async (role, _id, values) => ({ taskId: String(++serial), role, values, status: "pending" }));
  const read = async task => task.role === "branches" ? { ...task, nextPollAt: Date.now() + 15000, rows: [] }
    : { ...task, status: "completed", rows: task.role === "pages" ? [row]
      : task.role === "content" ? [{ url: row.Original_URL, title: product.name, content: "Confirmed dimensions" }] : [] };
  const result = await discoverOctoparseCatalog({ query: "parallel-specs lamp", country: "US", nearbyQuery: "lamp City", nearbyLocation: "City", relevant: () => true,
    specificationRequests: products => products.every(product => product.page.specificationText.includes("Confirmed dimensions")) ? [] : ["missing dimensions"],
    config: { octoparseApiKey: "parallel-specs-key" } }, { start, read });
  expect(result.sourceStatus.find(source => source.source === "Nearby branches via Octoparse").status).toBe("pending");
  expect(result.products[0].page.specificationText).toContain("Confirmed dimensions");
  expect(start.mock.calls.some(args => args[0] === "content")).toBe(true);
  expect(start.mock.calls.some(args => args[2].MainKeys?.includes("missing dimensions"))).toBe(false);
});

it("recovers facts before a stalled marketplace ends and keeps batches tied to their product URLs", async () => {
  vi.useFakeTimers();
  let expanded = false;
  const extra = { Product_URL: "https://www.ebay.com/itm/123456789012", Title: "Other lamp Model L200", Image_URL: "https://images.example/l200.jpg", Pricing: "$30", Condition: "New" };
  const start = vi.fn(async (role, _id, values) => ({ taskId: role, role, values, status: "pending" }));
  const read = async task => task.role === "marketplace" && !expanded ? { ...task, rows: [], nextPollAt: Date.now() + 15000 }
    : { ...task, status: "completed", rows: task.role === "pages" ? [row] : task.role === "marketplace" ? [extra]
      : task.role === "content" ? task.values.MainKeys.map(link => ({ url: link, title: link === row.Original_URL ? product.name : "Other lamp Model L200", content: "Confirmed product facts" })) : [] };
  const options = { query: "early-recovery lamp", country: "US", relevant: () => true, specificationRequests: () => ["missing facts"], config: { octoparseApiKey: "early-recovery-key" } };
  const first = await discoverOctoparseCatalog(options, { start, read });
  expect(first.products[0].page.specificationText).toContain("Confirmed product facts");
  expect(start.mock.calls.filter(args => args[0] === "content").map(args => args[2].MainKeys)).toEqual([[row.Original_URL]]);
  expect(first.sourceStatus.find(source => source.source === "marketplace via Octoparse").status).toBe("pending");
  expanded = true; vi.setSystemTime(first.nextPollAt + 1);
  const result = await discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(result.products[0].page.specificationText).toContain("Confirmed product facts");
  expect(result.products).toHaveLength(2);
  expect(result.products.every(product => product.page.specificationText.includes("Confirmed product facts"))).toBe(true);
  expect(start.mock.calls.filter(args => args[0] === "content").map(args => args[2].MainKeys)).toEqual([[row.Original_URL], [extra.Product_URL]]);
});

it("exports small pages in order without rounding the run identity", async () => {
  const call = vi.fn(async (_name, args) => ({ success: true, data: Array.from({ length: Math.min(5, 12 - (args.page - 1) * 5) }, (_, i) => ({ n: (args.page - 1) * 5 + i })) }));
  const result = await readPoolTask({ taskId: "paged", lotNo: "939260363630236283", status: "completed", collectedRows: 12 }, "key", { call });
  expect(result.rows.map(row => row.n)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  expect(call.mock.calls.map(args => args[1])).toEqual([1,2,3].map(page => ({ taskId: "paged", lotNo: "939260363630236283", page, pageSize: 5 })));
});

it("resumes compact page checkpoints without re-exporting successful HTML pages", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const call = vi.fn(async (_name, args) => {
    if (args.page === 1) vi.setSystemTime(start + 9000);
    return { success: true, data: [{ Original_URL: `https://shop.example/${args.page}`, Source_code: '<h1>Source HTML</h1>' }] };
  });
  const consume = (rows, progress) => ({ snapshot: [...(progress.snapshot ?? []), ...rows.map(row => row.Original_URL)] });
  const dependencies = { call, pageSize: 1, consume };
  const first = await withSearchBudget(() => readPoolTask({ taskId: "checkpoint", lotNo: "939260363630236287", status: "completed", collectedRows: 12 }, "key", dependencies), 10000);
  expect(first).toMatchObject({ status: "pending", exportedCount: 4, completedPages: [1, 2, 3, 4] });
  expect(JSON.stringify(first)).not.toContain("Source_code");
  const resumed = await withSearchBudget(() => readPoolTask(first, "key", dependencies), 10000);
  expect(resumed.status).toBe("completed");
  expect(resumed.snapshot).toHaveLength(12);
  expect(call.mock.calls.map(([, args]) => args.page)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
});

it("keeps a progressing run alive and stops only after it stalls", async () => {
  vi.useFakeTimers();
  const now = Date.now();
  const call = vi.fn(async name => name === "get_task_status" ? { lotNo: "939260363630236288", status: "running", collectedRows: 1 } : { success: true, data: [{ n: 1 }] });
  const dependencies = { request: async () => ({ userInputParameters: mapping }), call };
  const active = await readPoolTask({ taskId: "progress", lotNo: "939260363630236288", startedAt: now - 121000, status: "pending" }, "key", dependencies);
  expect(active.status).toBe("pending");
  expect(call.mock.calls.some(([name]) => name === "start_or_stop_task")).toBe(false);
  vi.setSystemTime(now + 121000);
  const stopped = await readPoolTask(active, "key", dependencies);
  expect(stopped).toMatchObject({ status: "failed", code: "search_timeout", rows: [{ n: 1 }] });
  expect(call.mock.calls.filter(([name]) => name === "start_or_stop_task")).toHaveLength(1);
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
      : task.role === "pages" && task.values["URLs (up to 10,000 per run)"].includes(row.Original_URL) ? [{ ...row, Source_code: row.Source_code.replace('</body>', '<address>32 Main Street</address></body>') }] : [];
    return { ...task, status: rows.length ? "completed" : "empty", rows };
  });
  const options = { query: "cold-worker lamp", country: "IL", nearbyQuery: "cold-worker city", nearbyLocation: "City", relevant: () => true, config: { octoparseApiKey: "cold-worker-key" } };
  const first = await discoverOctoparseCatalog(options, { start, read });
  expect(first.products).toHaveLength(1); expect(first.continuation).toBeTruthy();
  first.products[0].page.locations[0] = { ...first.products[0].page.locations[0], lat: 32.06, lon: 34.85 };
  first.continuation = persistOctoparseLocations(first, options.config.octoparseApiKey);
  const payload = { task: readContinuation(first.continuation, first.queryKey, options.config.octoparseApiKey) };
  expect(payload.task.pages.snapshot.products).toHaveLength(1);
  expect(JSON.stringify(payload)).not.toContain("Source_code");
  const reads = read.mock.calls.length;
  branchesReady = true;
  vi.resetModules();
  const cold = await import("./octoparse-catalog.mjs");
  const result = await cold.discoverOctoparseCatalog({ ...options, config: { ...options.config, continuation: first.continuation } }, { start, read });
  expect(result.products).toHaveLength(1); expect(result.continuation).toBeUndefined();
  expect(result.products[0].page.locations[0]).toMatchObject({ address: "32 Main Street", lat: 32.06, lon: 34.85 });
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
