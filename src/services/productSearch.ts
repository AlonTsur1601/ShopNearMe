import { getShowcase } from "../data/showcase";
import type { Facet, Offer, ShowcaseSearch } from "../types";
import type { LocationPlace } from "../components/LocationModal";

const demoQueries = /(sony|headphones?|wh-1000xm6)/i;

function genericFallback(query: string): ShowcaseSearch {
  const encoded = encodeURIComponent(query);
  const image = `https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=240&q=88`;
  const merchants = [
    ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${encoded}`],
    ["eBay", `https://www.ebay.com/sch/i.html?_nkw=${encoded}`],
    ["Walmart", `https://www.walmart.com/search?q=${encoded}`],
  ] as const;
  const offers: Offer[] = merchants.map(([merchant, destinationUrl], index) => ({
    id: `fallback-${index}`,
    category: index === 1 ? "secondHand" : "order",
    merchant,
    title: `${query} offers`,
    subtitle: index === 1 ? "New and pre-owned listings" : "Browse matching products",
    imageUrl: image,
    rating: 0,
    reviewCount: 0,
    itemPrice: null,
    shippingPrice: null,
    totalPrice: null,
    priceVerified: false,
    availability: "Open retailer",
    attributes: { marketplace: merchant, condition: index === 1 ? "Used" : "New" },
    destinationUrl,
  }));
  const facets: Facet[] = [
    { id: "marketplace", label: "Marketplace", options: merchants.map(([value]) => ({ value, count: 1 })) },
    { id: "condition", label: "Condition", options: [{ value: "New", count: 2 }, { value: "Used", count: 1 }] },
  ];
  return { query, resultCount: offers.length, offers, facets, source: "fallback" };
}

export async function searchProducts(query: string, location: string, signal?: AbortSignal, place?: LocationPlace): Promise<ShowcaseSearch> {
  const normalized = query.trim();
  if (demoQueries.test(normalized)) return { ...getShowcase(normalized), source: "showcase" };
  try {
    const params = new URLSearchParams({ q: normalized, location });
    if (place) { params.set("lat", String(place.lat)); params.set("lon", String(place.lon)); }
    const response = await fetch(`/api/search?${params}`, { signal });
    if (!response.ok) throw new Error(`Search request failed (${response.status})`);
    const result = await response.json() as ShowcaseSearch;
    if (!Array.isArray(result.offers) || !Array.isArray(result.facets)) throw new Error("Invalid search response");
    return { ...result, source: "live" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return genericFallback(normalized);
  }
}
