import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SortDirection } from "../types";

const options: Array<{ value: SortDirection; label: string }> = [{ value: "price-asc", label: "Price: Low to High" }, { value: "price-desc", label: "Price: High to Low" }, { value: "distance-asc", label: "Distance: Near to Far" }, { value: "distance-desc", label: "Distance: Far to Near" }];

export function SortMenu({ value, onChange, mobile = false }: { value: SortDirection; onChange: (value: SortDirection) => void; mobile?: boolean }) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null); const selected = options.find((option) => option.value === value)!;
  useEffect(() => { const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  return <div ref={root} className={`sort-menu${mobile ? " sort-menu--mobile" : ""}`}><button type="button" className="sort-menu__trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{selected.label}<ChevronDown size={17} /></button>{open && <div className="sort-menu__options" role="listbox" aria-label="Sort results">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={18} />}</button>)}</div>}</div>;
}
