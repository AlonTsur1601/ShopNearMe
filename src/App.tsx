import { ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilterPanel } from "./components/FilterPanel";
import { Header } from "./components/Header";
import { LocationModal, reversePlace, type LocationPlace } from "./components/LocationModal";
import { OfferSection } from "./components/OfferSection";
import { SearchBar } from "./components/SearchBar";
import { SortMenu } from "./components/SortMenu";
import { getShowcase } from "./data/showcase";
import { searchProducts } from "./services/productSearch";
import { recommendationsFor } from "./services/recommendations";
import { distanceUnitFor } from "./services/distance";
import type { OfferCategory, ShowcaseSearch, SortDirection } from "./types";
import { registerShopNearMeTools } from "./webmcp";

const categories: OfferCategory[] = ["local", "order", "secondHand"];
function readRecent(): string[] { try { return JSON.parse(localStorage.getItem("shopnearme:recent") ?? "[]") as string[]; } catch { return []; } }
function getBrowserLocation(): Promise<LocationPlace> { return new Promise((resolve, reject) => { if (!navigator.geolocation) { reject(new Error("Geolocation unavailable")); return; } navigator.geolocation.getCurrentPosition(({ coords }) => { void reversePlace(coords.latitude, coords.longitude).catch(() => ({ label: "Current location", lat: coords.latitude, lon: coords.longitude })).then(resolve); }, reject, { enableHighAccuracy: false, timeout: 3000, maximumAge: 300000 }); }); }

export function App() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [location, setLocation] = useState("Current location");
  const [locationPlace, setLocationPlace] = useState<LocationPlace>();
  const [locationOpen, setLocationOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortDirection>("price-asc");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [distance, setDistance] = useState(50);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [searchResult, setSearchResult] = useState<ShowcaseSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecent);
  const showcase: ShowcaseSearch = searchResult ?? { query: activeQuery ?? "", offers: [], facets: [], resultCount: 0 };

  const visibleOffers = useMemo(() => {
    const offers = showcase.offers.filter((offer) => {
      if (offer.distanceMiles !== undefined && offer.distanceMiles > distance) return false;
      if (priceMin && (offer.totalPrice === null || offer.totalPrice < Number(priceMin))) return false;
      if (priceMax && (offer.totalPrice === null || offer.totalPrice > Number(priceMax))) return false;
      return Object.entries(selected).every(([facet, values]) => !values.length || values.includes(offer.attributes[facet]));
    });
    return [...offers].sort((a, b) => {
      if (sort.startsWith("distance")) {
        const left = a.distanceMiles ?? Number.POSITIVE_INFINITY, right = b.distanceMiles ?? Number.POSITIVE_INFINITY;
        return sort === "distance-asc" ? left - right : (a.distanceMiles === undefined ? 1 : b.distanceMiles === undefined ? -1 : right - left);
      }
      if (a.totalPrice === null && b.totalPrice === null) return 0;
      if (a.totalPrice === null) return 1;
      if (b.totalPrice === null) return -1;
      return sort === "price-asc" ? a.totalPrice - b.totalPrice : b.totalPrice - a.totalPrice;
    });
  }, [distance, priceMax, priceMin, selected, showcase.offers, sort]);

  const chips = Object.entries(selected).flatMap(([facet, values]) => values.map((value) => ({ facet, value })));
  const performSearch = useCallback(async (nextQuery: string, nextLocation = location) => {
    const normalized = nextQuery.trim(); if (!normalized) return getShowcase("Sony WH-1000XM6");
    searchController.current?.abort(); const controller = new AbortController(); searchController.current = controller;
    setQuery(normalized); setActiveQuery(normalized); setSelected({}); setLoading(true); setSearchResult(null);
    setRecentSearches((current) => { const next = [normalized, ...current.filter((value) => value.toLowerCase() !== normalized.toLowerCase())].slice(0, 5); localStorage.setItem("shopnearme:recent", JSON.stringify(next)); return next; });
    try {
      let place = nextLocation === location ? locationPlace : undefined;
      if (nextLocation === "Current location" && !place) { try { place = await getBrowserLocation(); if (!controller.signal.aborted) setLocationPlace(place); } catch { place = undefined; } }
      const result = await searchProducts(normalized, place?.label ?? nextLocation, controller.signal, place);
      if (!controller.signal.aborted) setSearchResult(result);
      return result;
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [location, locationPlace]);
  const search = () => { void performSearch(query); };
  const goHome = () => { setActiveQuery(null); setQuery(""); setSelected({}); setSearchResult(null); };
  const toggleFilter = (facet: string, value: string) => setSelected((current) => { const values = current[facet] ?? []; return { ...current, [facet]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] }; });
  const clearFilters = () => { setSelected({}); setDistance(50); setPriceMin(""); setPriceMax(""); };
  const runExample = (value: string) => { void performSearch(value); };
  const distanceUnit = distanceUnitFor(locationPlace?.label ?? location);
  const filterProps = { facets: showcase.facets, selected, distance, distanceUnit, priceMin, priceMax, currency: showcase.offers.find((offer) => offer.currency)?.currency ?? "USD", onToggle: toggleFilter, onDistance: setDistance, onPriceMin: setPriceMin, onPriceMax: setPriceMax, onClear: clearFilters };

  useEffect(() => registerShopNearMeTools({
    search: async (value, nextLocation) => { if (nextLocation) { setLocation(nextLocation); setLocationPlace(undefined); } return performSearch(value, nextLocation ?? location); },
    setLocation: (value) => { setLocation(value); setLocationPlace(undefined); },
    getResults: () => searchResult,
    setFilters: (filters) => { setSelected(filters); },
    setSort,
  }), [location, performSearch, searchResult]);

  return <div className="app">
    <Header onHome={goHome} />
    {activeQuery === null ? <main className="home">
      <div className="home__content">
        <h1>Find the right product, at the right price.</h1>
        <p>Compare offers you can order, pick up nearby, or buy second hand.</p>
        <SearchBar query={query} location={location} onQueryChange={setQuery} onSubmit={search} onLocation={() => setLocationOpen(true)} />
        <button className="home-location" type="button" onClick={() => setLocationOpen(true)}>Searching near <strong>{location}</strong><ChevronRight size={17} /></button>
        {recentSearches.length > 0 && <div className="search-discovery">
          <div className="example-searches"><span>Recent:</span>{recentSearches.slice(0, 3).map((value) => <button key={value} onClick={() => runExample(value)}>{value}</button>)}</div>
          {recommendationsFor(recentSearches).length > 0 && <div className="example-searches example-searches--recommended"><span>Recommended:</span>{recommendationsFor(recentSearches).slice(0, 3).map((value) => <button key={value} onClick={() => runExample(value)}>{value}</button>)}</div>}
        </div>}
      </div>
      <div className="webmcp-note"><span aria-hidden="true">⌁</span><div><strong>Built for people and AI agents</strong><small>ShopNearMe supports structured product research with WebMCP.</small></div></div>
    </main> : <main className="results-page">
      <SearchBar compact query={query} location={location} onQueryChange={setQuery} onSubmit={search} onLocation={() => setLocationOpen(true)} />
      <div className="results-layout">
        {!loading && searchResult ? <FilterPanel {...filterProps} /> : <aside className="filters" aria-label="Filters awaiting results" />}
        <div className="results-main">
          <div className="mobile-toolbar">
            <button type="button" className="mobile-filter-button" disabled={loading || !searchResult} onClick={(event) => { event.stopPropagation(); setFiltersOpen(true); }}><SlidersHorizontal size={20} />Filters<ChevronRight size={20} /></button>
            <SortMenu mobile value={sort} onChange={setSort} />
          </div>
          <div className={chips.length ? "result-controls" : "result-controls result-controls--empty"}>
            {chips.length > 0 && <div className="filter-chips">{chips.map(({ facet, value }) => <button key={`${facet}-${value}`} onClick={() => toggleFilter(facet, value)}>{value}<X size={14} /></button>)}<button className="clear-chip" onClick={clearFilters}>Clear all</button></div>}
            <div className="results-meta"><span>{loading ? "Searching…" : `${visibleOffers.length} results`}</span><div className="sort-control"><span>Sort by</span><SortMenu value={sort} onChange={setSort} /></div></div>
          </div>
          <div className="offers-scroll">
            {!loading && showcase.warnings?.map((warning) => <p className="search-warning" role="status" key={warning}>{warning}</p>)}
            {!loading && categories.map((category) => <OfferSection key={category} category={category} offers={visibleOffers.filter((offer) => offer.category === category)} distanceUnit={distanceUnit} />)}
            {loading && <div className="search-loading" aria-live="polite"><span /><strong>Searching stores and delivery sites…</strong></div>}
            {!loading && !visibleOffers.length && <div className="empty-results"><h2>{showcase.source === "fallback" ? "Search temporarily unavailable" : "No matching offers"}</h2><p>{showcase.source === "fallback" ? "Please try again in a moment. No guessed retailer links are shown." : "Clear a filter or try a broader search."}</p>{showcase.source !== "fallback" && <button className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>}
          </div>
        </div>
      </div>
    </main>}
    {filtersOpen && !loading && searchResult && <div className="drawer-backdrop" onClick={() => setFiltersOpen(false)}><div onClick={(event) => event.stopPropagation()}><FilterPanel {...filterProps} mobile onClose={() => setFiltersOpen(false)} /></div></div>}
    {locationOpen && <LocationModal current={location} initial={locationPlace} onClose={() => setLocationOpen(false)} onSelect={(value) => { setLocation(value.label); setLocationPlace(value); setLocationOpen(false); }} />}
  </div>;
}
