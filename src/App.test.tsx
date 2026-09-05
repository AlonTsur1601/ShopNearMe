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
  beforeEach(() => { localStorage.clear(); vi.mocked(searchProducts).mockClear(); });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

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
    await waitFor(() => expect(screen.getAllByText("Clock type")[0]).toBeVisible());
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
