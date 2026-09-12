import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { searchProducts } from "./services/productSearch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { clockShowcase } from "./data/showcase";
import { OfferSection } from "./components/OfferSection";

vi.mock("./services/productSearch", () => ({
  searchProducts: vi.fn(async () => ({ ...clockShowcase, source: "showcase" })),
  isShowcaseQuery: vi.fn(() => true),
  searchProductScope: vi.fn(),
  mergeSearchResults: vi.fn(),
  genericFallback: vi.fn(),
}));

describe("App", () => {
  it("marks an out-of-stock notice for the red status style", () => {
    render(<OfferSection category="order" distanceUnit="km" offers={[{ ...clockShowcase.offers[0], availability: "Out of stock" }]} />);
    expect(screen.getByText("Out of stock")).toHaveClass("stock-unavailable");
  });
  beforeEach(() => { localStorage.clear(); vi.mocked(searchProducts).mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it("shows a working clear X on the homepage before a search is submitted", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search for a product" }), { target: { value: "dining table" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("textbox", { name: "Search for a product" })).toHaveValue("");
    expect(screen.getByRole("heading", { name: /Find the right product/ })).toBeVisible();
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("clears just the input without leaving results, resetting filters or submitting", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByLabelText("Product filters")).toBeVisible());
    fireEvent.click(screen.getByRole("checkbox", { name: /Wall clock/ }));
    const calls = vi.mocked(searchProducts).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByPlaceholderText("Search any product")).toHaveValue("");
    expect(screen.getByPlaceholderText("Search any product")).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /Wall clock/ })).toBeChecked();
    expect(screen.getByLabelText("Product filters")).toBeVisible();
    expect(searchProducts).toHaveBeenCalledTimes(calls);
  });

  it("tries the next real product image when the first image fails", () => {
    const offer = { ...clockShowcase.offers[0], imageUrl: "https://shop.example/broken.jpg", imageUrls: ["https://shop.example/actual.jpg"] };
    const view = render(<OfferSection category="order" offers={[offer]} distanceUnit="km" />);
    const image = view.container.querySelector<HTMLImageElement>(".product-image")!;
    fireEvent.error(image);
    expect(view.container.querySelector(".product-image")).toHaveAttribute("src", "https://shop.example/actual.jpg");
    fireEvent.error(view.container.querySelector(".product-image")!);
    expect(screen.getByLabelText("No product image available")).toBeVisible();
  });

  it("shows a store image and an explicit unavailable price without a potential-retailer notice", () => {
    const offer = { ...clockShowcase.offers[0], id: "store", category: "local" as const, merchant: "Clock Shop", potentialStore: true, imageUrl: "", imageUrls: [], merchantLogoUrl: "https://clock-shop.example/logo.png", itemPrice: null, totalPrice: null, availability: "" };
    const view = render(<OfferSection category="local" offers={[offer]} distanceUnit="km" />);
    expect(view.container.querySelector(".product-image")).toHaveAttribute("src", offer.merchantLogoUrl);
    expect(screen.getByText("Price unavailable")).toBeVisible();
    expect(screen.queryByText(/potential retailer|product listing confirmed/i)).not.toBeInTheDocument();
  });

  it("uses an identifiable store tile after every remote store image fails", () => {
    const offer = { ...clockShowcase.offers[0], id: "store-tile", category: "local" as const, merchant: "Clock Shop", potentialStore: true, imageUrl: "", imageUrls: [], merchantLogoUrl: "", itemPrice: null, totalPrice: null, availability: "", destinationUrl: "https://www.google.com/maps/search/?api=1&query_place_id=clock-shop" };
    const view = render(<OfferSection category="local" offers={[offer]} distanceUnit="km" />);
    expect(view.container.querySelector(".store-image")).toBeVisible();
    expect(screen.getByLabelText("Clock Shop store")).toHaveTextContent("C");
  });

  it("separates product and store totals so product-filter counts have the same denominator", async () => {
    const store = { ...clockShowcase.offers[0], id: "store-total", category: "local" as const, potentialStore: true, imageUrl: "", itemPrice: null, totalPrice: null, availability: "", attributes: { retailer: "Clock Shop" } };
    vi.mocked(searchProducts).mockResolvedValueOnce({ ...clockShowcase, offers: [clockShowcase.offers[0], store], resultCount: 2 });
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("1 product · 1 store")).toBeVisible();
  });

  it("automatically uses default current-location coordinates without manually choosing a place", async () => {
    const get = vi.fn(success => success({ coords: { latitude: 32.084, longitude: 34.887 } }));
    vi.stubGlobal("navigator", Object.create(navigator, { geolocation: { value: { getCurrentPosition: get } } }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ address: { city: "Petah Tikva", country: "Israel" } }) })));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith("clock", "Petah Tikva, Israel", expect.any(AbortSignal), { label: "Petah Tikva, Israel", lat: 32.084, lon: 34.887 }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Choose a location to include nearby stores.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    await waitFor(() => expect(searchProducts).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("displays the shipment total and item, shipping and import breakdown without changing local prices", () => {
    const offer = { ...clockShowcase.offers[0], id: "fees", category: "order" as const, itemPrice: 100, shippingPrice: 20, importTaxPrice: 12, totalPrice: 132, currency: "USD" };
    const view = render(<OfferSection category="order" offers={[offer]} distanceUnit="km" />);
    expect(screen.getByText("$132.00")).toBeVisible();
    expect(screen.getByText("Item: $100.00")).toBeVisible();
    expect(screen.getByText("Shipping: $20.00")).toBeVisible();
    expect(screen.getByText("Import taxes: $12.00")).toBeVisible();
    view.rerender(<OfferSection category="local" offers={[{ ...offer, totalPrice: 100 }]} distanceUnit="km" />);
    expect(screen.getByText("$100.00")).toBeVisible();
    expect(screen.queryByText(/Item:/)).not.toBeInTheDocument();
  });

  it("renders the approved home search surface without random suggestions", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "ShopNearMe home" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Find the right product/i })).toBeVisible();
    expect(screen.getByPlaceholderText("Search any product")).toBeVisible();
    expect(screen.queryByText("Try:")).not.toBeInTheDocument();
  });

  it("opens a general clock search with clock-specific facets", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const clockType = await screen.findByRole("button", { name: "Clock type" });
    expect(clockType).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: /Wall clock/ })).toBeVisible();
    fireEvent.click(clockType);
    expect(clockType).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: /Wall clock/ })).not.toBeInTheDocument();
    fireEvent.click(clockType);
    expect(clockType).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: /Wall clock/ })).toBeVisible();
    expect(screen.getAllByText("Movement")[0]).toBeVisible();
    const localHeading = screen.getByRole("heading", { name: /Buy in store/ });
    const onlineHeading = screen.getByRole("heading", { name: /Order online/ });
    expect(localHeading.compareDocumentPosition(onlineHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides all filters until the pending search has returned real results", async () => {
    let release!: (value: typeof clockShowcase) => void;
    vi.mocked(searchProducts).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.queryByLabelText("Product filters")).not.toBeInTheDocument();
    expect(screen.queryByText("Clock type")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeDisabled();
    await act(async () => release(clockShowcase));
    expect(screen.getByLabelText("Product filters")).toBeVisible();
    expect(screen.getByRole("button", { name: "Filters" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Wall clock/ }));
    expect(screen.queryByRole("heading", { name: /Second hand/ })).not.toBeInTheDocument();
  });

  it("registers the agent-facing WebMCP surface when supported", () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
    const view = render(<App />);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(expect.arrayContaining(["search_products", "get_visible_results", "set_search_location", "filter_results", "sort_results"]));
    view.unmount();
    Reflect.deleteProperty(document, "modelContext");
  });

  it("returns the displayed filtered and sorted offers through WebMCP", async () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
    const view = render(<App />);
    const tool = (name: string) => registerTool.mock.calls.find(([definition]) => definition.name === name)![0];
    await act(async () => { await tool("search_products").execute({ query: "clock", location: "Tel Aviv, Israel" }); });
    const total = tool("get_visible_results").execute({}).offers.length;
    await act(async () => { await tool("filter_results").execute({ filters: { type: ["Wall clock"] } }); });
    await act(async () => { await tool("sort_results").execute({ direction: "price-desc" }); });
    const result = tool("get_visible_results").execute({});
    expect(result.resultCount).toBeGreaterThan(0);
    expect(result.resultCount).toBeLessThan(total);
    expect(result.offers.every((offer: { attributes: Record<string, string | string[]> }) => [offer.attributes.type].flat().includes("Wall clock"))).toBe(true);
    const prices = result.offers.map((offer: { totalPrice: number }) => offer.totalPrice);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(screen.getByText(`${result.resultCount} results`)).toBeVisible();
    expect(registerTool).toHaveBeenCalledTimes(5);
    view.unmount();
    Reflect.deleteProperty(document, "modelContext");
  });

  it("opens and closes the scrollable mobile filter drawer", async () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Search any product"), { target: { value: "clock" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Filters" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getAllByLabelText("Product filters")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.getAllByLabelText("Product filters")).toHaveLength(1);
    expect(screen.queryByText(/unverified prices/i)).not.toBeInTheDocument();
  });

  it("does not render an empty shopping category", () => {
    render(<OfferSection category="local" offers={[]} distanceUnit="km" />);
    expect(screen.queryByRole("heading", { name: /Buy in store/ })).not.toBeInTheDocument();
  });
});
