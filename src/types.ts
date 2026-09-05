export type OfferCategory = "order" | "local" | "secondHand";
export type Offer = { id: string; category: OfferCategory; merchant: string; merchantLogoUrl?: string; title: string; subtitle: string; imageUrl: string; rating: number; reviewCount: number; itemPrice: number | null; shippingPrice: number | null; totalPrice: number | null; currency?: string; originalCurrency?: string; exchangeRateDate?: string; shippingEstimated?: boolean; priceVerified: boolean; availability: string; arrival?: string; distanceMiles?: number; condition?: string; attributes: Record<string, string>; destinationUrl: string; linkLabel?: string; };
export type FacetOption = { value: string; count: number; };
export type Facet = { id: string; label: string; options: FacetOption[]; };
export type SearchSource = "showcase" | "live" | "fallback";
export type ShowcaseSearch = { query: string; resultCount: number; offers: Offer[]; facets: Facet[]; source?: SearchSource; warnings?: string[]; };
export type SortDirection = "price-asc" | "price-desc" | "distance-asc" | "distance-desc";
