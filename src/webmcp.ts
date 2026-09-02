import type { ShowcaseSearch, SortDirection } from "./types";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

type ModelContext = { registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => Promise<void> | void };

declare global { interface Document { modelContext?: ModelContext } }

export type WebMCPBridge = {
  search: (query: string, location?: string) => Promise<ShowcaseSearch>;
  setLocation: (location: string) => void;
  getResults: () => ShowcaseSearch | null;
  setFilters: (filters: Record<string, string[]>, showUnverified?: boolean) => void;
  setSort: (sort: SortDirection) => void;
};

export function registerShopNearMeTools(bridge: WebMCPBridge): () => void {
  if (!document.modelContext) return () => undefined;
  const controller = new AbortController();
  const register = (tool: ToolDefinition) => {
    try {
      const registration = document.modelContext?.registerTool(tool, { signal: controller.signal });
      void Promise.resolve(registration).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error); });
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error); }
  };
  register({ name: "search_products", title: "Search products near a location", description: "Search delivery, nearby in-store, and second-hand offers for any product. Returns structured offers with total prices including shipping.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Any product name or description" }, location: { type: "string", description: "City, address, postal code, or Current location" } }, required: ["query"] }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async ({ query, location }) => bridge.search(String(query), location ? String(location) : undefined) });
  register({ name: "get_visible_results", title: "Get current product results", description: "Return the product offers currently loaded in ShopNearMe, grouped by purchase method.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => bridge.getResults() ?? { message: "No search is currently loaded." } });
  register({ name: "set_search_location", title: "Set search location", description: "Set the location used for nearby stores and delivery eligibility.", inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: ({ location }) => { bridge.setLocation(String(location)); return { location: String(location) }; } });
  register({ name: "filter_results", title: "Filter product results", description: "Apply product-specific facet filters. Values must match the facet options returned by search_products.", inputSchema: { type: "object", properties: { filters: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } }, showUnverifiedPrices: { type: "boolean" } }, required: ["filters"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: ({ filters, showUnverifiedPrices }) => { bridge.setFilters((filters ?? {}) as Record<string, string[]>, Boolean(showUnverifiedPrices)); return { applied: true }; } });
  register({ name: "sort_results", title: "Sort product results", description: "Sort current offers by total price, which includes shipping for delivery offers.", inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["price-asc", "price-desc"] } }, required: ["direction"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: ({ direction }) => { bridge.setSort(direction as SortDirection); return { direction }; } });
  return () => controller.abort();
}
