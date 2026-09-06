import { Crosshair, Search, X } from "lucide-react";
import { useRef, type FormEvent } from "react";
export function SearchBar({ query, location, compact, onQueryChange, onSubmit, onLocation }: { query: string; location: string; compact?: boolean; onQueryChange: (value: string) => void; onSubmit: () => void; onLocation: () => void; }) {
  const input = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => { event.preventDefault(); if (query.trim()) onSubmit(); };
  return <form className={compact ? "search-bar" : "search-bar search-bar--hero"} onSubmit={submit}><div className="search-field"><Search size={22} /><input ref={input} aria-label="Search for a product" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search any product" autoComplete="off" />{query && <button className="search-clear" type="button" aria-label="Clear search" onClick={() => { onQueryChange(""); input.current?.focus(); }}><X size={17} /></button>}</div>{<button className="search-location" type="button" onClick={onLocation}><Crosshair size={19} /><span>{!compact && "Searching near "}{location}</span></button>}<button className="primary-button search-submit" type="submit">Search</button></form>;
}
