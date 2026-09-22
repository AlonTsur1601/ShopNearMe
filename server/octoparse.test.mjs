import { afterEach, expect, it, vi } from "vitest";
import { octoparseTool, decodeRpc, readOctoparseTask, startOctoparseTask, findOctoparseTask } from "./octoparse.mjs";
import { discoverOctoparseProducts, octoparseProducts, octoparsePlaces, readRetailRows, readContinuation, signContinuation } from "./octoparse-discovery.mjs";

afterEach(() => vi.useRealTimers());
const task = { taskId: "task-1", lotNo: "939255040428148360", nextPollAt: 0 };
const row = { Product_URL_clean: "https://www.amazon.com/dp/B004YAVF8I", Product_name: "Logitech wireless mouse", Image_link: "https://m.media-amazon.com/mouse.jpg", Current_price: "$13.99", Product_status: "Valid" };

it("keeps branch data separate from product offers and requires real coordinates", () => {
  const place = { Title: "Store", Website: "https://merchant.example", Latitude: "32.06", Longitude: "34.85", Address: "Main St" };
  expect(octoparsePlaces([place, { ...place, Latitude: "" }, { ...place, Current_Status: "Permanently closed" }])).toHaveLength(1);
  expect(octoparsePlaces([place])[0].gps_coordinates).toEqual({ latitude: 32.06, longitude: 34.85 });
  expect(octoparseProducts([place], () => true, "mouse")).toEqual([]);
});

it("follows catalog links but accepts only verified individual merchant products", async () => {
  const page = { isProduct: true, title: "Wireless mouse", price: 59, currency: "ILS", imageUrl: "https://shop.example/mouse.jpg" };
  const read = async url => url.endsWith("/catalog") ? { isCatalog: true } : url.endsWith("/missing") ? { ...page, price: null } : page;
  const catalog = async () => [{ link: "https://shop.example/product" }, { link: "https://shop.example/missing" }];
  const products = await readRetailRows([{ Detail_URL: "https://shop.example/catalog" }], () => true, "mouse", read, catalog);
  expect(products.map(product => product.link)).toEqual(["https://shop.example/product"]);
});

it("decodes current MCP structured output and ignores progress events", () => {
  expect(decodeRpc('event: message\ndata: {"method":"notifications/progress"}\n\nevent: message\ndata: {"id":2,"result":{"structuredContent":{"success":true,"data":[]}}}\n\n', 2)).toEqual({ success: true, data: [] });
  expect(() => decodeRpc('{"id":2,"result":{"isError":true}}', 2)).toThrow();
});

it("serializes template input and caps task rows without rounding the lot number", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { success: true, taskId: task.taskId, lotNo: task.lotNo, retryGuidance: { waitSecondsMin: 60 } } }));
  const started = await startOctoparseTask("amazon-search-scraper", { search_Term: ["mouse"] }, "test", "test-key", 1000, fetcher);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ parameters: '{"search_Term":["mouse"]}', targetMaxRows: 20 });
  expect(started.lotNo).toBe(task.lotNo);
  expect(started.status).toBe("pending");
});

it("does not poll before the provider's deadline or turn running into no offers", async () => {
  const call = vi.fn(async () => ({ success: true, ...task, status: "running", collectedRows: 0 }));
  expect((await readOctoparseTask({ ...task, status: "pending", nextPollAt: Date.now() + 60000 }, "key", call)).status).toBe("pending");
  expect(call).not.toHaveBeenCalled();
  expect((await readOctoparseTask(task, "key", call)).status).toBe("pending");
  expect(call).toHaveBeenCalledTimes(1);
});

it("exports the exact completed lot with explicit integer pagination", async () => {
  const call = vi.fn().mockResolvedValueOnce({ success: true, ...task, status: "completed", collectedRows: 5 }).mockResolvedValueOnce({ success: true, data: [row] });
  expect((await readOctoparseTask(task, "key", call)).rows).toEqual([row]);
  expect(call).toHaveBeenLastCalledWith("export_data", { taskId: task.taskId, lotNo: task.lotNo, page: 1, pageSize: 20 }, "key");
});

it("rejects a different lot and distinguishes empty terminal jobs", async () => {
  await expect(readOctoparseTask(task, "key", async () => ({ success: true, lotNo: "2", status: "completed" }))).rejects.toThrow();
  expect((await readOctoparseTask(task, "key", async () => ({ success: true, ...task, status: "completed", collectedRows: 0 }))).status).toBe("empty");
});

it("does not create replacements when recovery lookup fails", async () => {
  await expect(findOctoparseTask("test", "key", async () => Response.json({ error: "unavailable" }, { status: 502 }))).rejects.toThrow();
});

it("preserves priced non-eBay products and rejects catalog, image, currency and stock failures", () => {
  const bad = [{ Product_URL_clean: "https://www.amazon.com/s?k=mouse" }, { Image_link: "" }, { Current_price: "" }, { Current_price: "$0" }, { Current_price: "13,99 EUR" }, { In_stock: "Out of stock" }, { Product_URL_clean: "https://evil.example/dp/B004YAVF8I" }];
  const products = octoparseProducts([row, ...bad.map(change => ({ ...row, ...change }))], () => true, "mouse");
  expect(products).toHaveLength(1);
  expect(products[0].page).toMatchObject({ price: 13.99, currency: "USD", locations: [] });
});

it("binds continuation to its query and key and rejects tampering or expiry", () => {
  const token = signContinuation(task, "mouse", "secret");
  expect(readContinuation(token, "mouse", "secret")).toEqual(task);
  expect(() => readContinuation(token, "laptop", "secret")).toThrow();
  expect(() => readContinuation(token, "mouse", "different")).toThrow();
  expect(() => readContinuation(token + "x", "mouse", "secret")).toThrow();
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3600001);
  expect(() => readContinuation(token, "mouse", "secret")).toThrow();
});

it("coalesces duplicate searches and resumes a cloud job without submitting it again", async () => {
  vi.useFakeTimers();
  const start = vi.fn(async () => ({ ...task, status: "pending", nextPollAt: Date.now() + 60000 }));
  const read = vi.fn(async t => Date.now() < t.nextPollAt ? { ...t, status: "pending", rows: [] } : { ...t, status: "completed", rows: [row] });
  const options = { query: "wireless mouse", config: { octoparseApiKey: "coalesce-key" }, relevant: () => true };
  const dependencies = { start, read, find: async () => null };
  const [first, duplicate] = await Promise.all([discoverOctoparseProducts(options, dependencies), discoverOctoparseProducts(options, dependencies)]);
  expect(first).toEqual(duplicate);
  expect(first.sourceStatus[0].status).toBe("pending");
  expect(start).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 60001);
  const result = await discoverOctoparseProducts({ ...options, config: { ...options.config, continuation: first.continuation } }, dependencies);
  expect(result.products).toHaveLength(1);
  expect(result.continuation).toBeUndefined();
  expect(start).toHaveBeenCalledTimes(1);
});

it("uses unique RPC ids when parallel tasks share a session", async () => {
  const ids = [];
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (!request.id) return new Response(null, { status: 202 });
    ids.push(request.id);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize" ? {} : { structuredContent: { success: true, taskId: request.params.arguments.taskId } } }, { headers: { "mcp-session-id": "test-session" } });
  };
  await octoparseTool("get_task_status", { taskId: "warm" }, "parallel-test", fetcher);
  const results = await Promise.all(["products", "branches"].map(taskId => octoparseTool("get_task_status", { taskId }, "parallel-test", fetcher)));
  expect(results.map(result => result.taskId)).toEqual(["products", "branches"]);
  expect(new Set(ids).size).toBe(ids.length);
});

it("does not use the map viewport as a store's address", () => {
  expect(octoparsePlaces([{ Title: "Store", Website: "https://store.example", Latitude_backup: "32", Longitude_backup: "34" }])).toEqual([]);
});
it("classifies allowance errors inside structured tool results", () => {
  expect(() => decodeRpc(JSON.stringify({ id: 3, result: { structuredContent: { success: false, message: "Weekly export quota exhausted" } } }), 3)).toThrow(expect.objectContaining({ code: "quota_exhausted" }));
});

it("identifies the saved-task ceiling without retrying task creation", async () => {
  const fetcher = vi.fn(async () => Response.json({ data: { success: false, error: "task_quantity_limit_reached", message: "Delete unused tasks; do not retry executeTask." } }));
  await expect(startOctoparseTask("google-search-scraper", {}, "test task", "test-key", 1, fetcher)).rejects.toMatchObject({ code: "task_limit_reached" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("uses a merchant's own category path when a product title contains only its model", async () => {
  const product = { isProduct: true, title: "Aspen Black LED", price: 199.9, currency: "ILS", imageUrl: "https://lighting.example/lamp.jpg" };
  const results = await readRetailRows([{ Detail_URL: "https://lighting.example/table-lamp/123" }], text => text.includes("table lamp"), "table lamp", async () => product);
  expect(results).toHaveLength(1);
  expect(results[0].title).toBe("Aspen Black LED");
});
