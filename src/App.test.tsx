import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => { localStorage.clear(); });

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
    await waitFor(() => expect(screen.getByText("Clock type")).toBeVisible());
    expect(screen.getByText("Movement")).toBeVisible();
    const localHeading = screen.getByRole("heading", { name: /Buy in store/ });
    const onlineHeading = screen.getByRole("heading", { name: /Order online/ });
    expect(localHeading.compareDocumentPosition(onlineHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("registers the agent-facing WebMCP surface when supported", () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
    const view = render(<App />);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(expect.arrayContaining(["search_products", "get_visible_results", "set_search_location", "filter_results", "sort_results"]));
    view.unmount();
    Reflect.deleteProperty(document, "modelContext");
  });

  it("does not render an empty shopping category", () => {
    render(<OfferSection category="local" offers={[]} />);
    expect(screen.queryByRole("heading", { name: /Buy in store/ })).not.toBeInTheDocument();
  });
});
