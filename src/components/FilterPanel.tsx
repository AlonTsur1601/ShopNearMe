import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import type { Facet } from "../types";
import { displayDistance, type DistanceUnit } from "../services/distance";

type Props = { facets: Facet[]; selected: Record<string, string[]>; distance: number; distanceUnit: DistanceUnit; priceMin: string; priceMax: string; currency?: string; mobile?: boolean; onToggle: (facet: string, value: string) => void; onDistance: (value: number) => void; onPriceMin: (value: string) => void; onPriceMax: (value: string) => void; onClear: () => void; onClose?: () => void; };
type FacetSectionProps = { id: string; label: string; collapsed: boolean; onToggle: () => void; className?: string; children: ReactNode };

function FacetSection({ id, label, collapsed, onToggle, className = "", children }: FacetSectionProps) {
  return <fieldset className={`facet ${className}`.trim()}><legend className="sr-only">{label}</legend>
    <button type="button" className="facet__title" aria-expanded={!collapsed} aria-controls={`facet-${id}`} onClick={onToggle}><span>{label}</span><ChevronDown size={15} /></button>
    {!collapsed && <div id={`facet-${id}`}>{children}</div>}
  </fieldset>;
}

export function FilterPanel({ facets, selected, distance, distanceUnit, priceMin, priceMax, currency = "USD", mobile, onToggle, onDistance, onPriceMin, onPriceMax, onClear, onClose }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleSection = (id: string) => setCollapsed(current => ({ ...current, [id]: !current[id] }));
  return <aside className={mobile ? "filters filters--mobile" : "filters"} aria-label="Product filters">
    <div className="filters__header"><strong>Filters</strong><button type="button" className="text-button" onClick={onClear}>Clear all</button>{mobile && <button type="button" className="icon-button" onClick={onClose} aria-label="Close filters"><X size={21} /></button>}</div>
    <div className="filter-scroll">{facets.map((facet) => <FacetSection key={facet.id} id={facet.id} label={facet.label} collapsed={!!collapsed[facet.id]} onToggle={() => toggleSection(facet.id)}>{facet.options.map((option) => { const checked = selected[facet.id]?.includes(option.value) ?? false; return <label className="checkbox-row" key={option.value}><input type="checkbox" checked={checked} onChange={() => onToggle(facet.id, option.value)} /><span>{option.value}</span><small>{option.count}</small></label>; })}</FacetSection>)}
      <FacetSection id="distance" label="Distance" collapsed={!!collapsed.distance} onToggle={() => toggleSection("distance")} className="facet--distance"><input aria-label="Maximum distance" type="range" min="1" max="50" value={distance} onChange={(event) => onDistance(Number(event.target.value))} /><div className="range-labels"><span>{displayDistance(1, distanceUnit)}</span><span>{displayDistance(distance, distanceUnit)}</span></div></FacetSection>
      <FacetSection id="total-price" label="Total price" collapsed={!!collapsed["total-price"]} onToggle={() => toggleSection("total-price")}><div className="price-inputs"><label>{new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(0).replace(/[\d.,\s]/g, "")}<input aria-label="Minimum price" placeholder="Min" inputMode="decimal" value={priceMin} onChange={(event) => onPriceMin(event.target.value)} /></label><label>{new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(0).replace(/[\d.,\s]/g, "")}<input aria-label="Maximum price" placeholder="Max" inputMode="decimal" value={priceMax} onChange={(event) => onPriceMax(event.target.value)} /></label></div></FacetSection>
    </div>
  </aside>;
}
