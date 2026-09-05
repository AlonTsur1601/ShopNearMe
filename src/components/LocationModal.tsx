import { Crosshair, MapPin, Search, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { getCurrentLocation, reversePlace, type LocationPlace } from "../services/currentLocation";
export { reversePlace, type LocationPlace } from "../services/currentLocation";

type Place = LocationPlace;
const pin = L.divIcon({ className: "shop-map-pin", html: '<span aria-hidden="true"></span>', iconSize: [42, 42], iconAnchor: [21, 40] });
function Recenter({ place }: { place: Place }) { const map = useMap(); useEffect(() => { map.setView([place.lat, place.lon], map.getZoom() || 13); }, [map, place]); return null; }
function ContainMapScroll() { const map = useMap(); useEffect(() => { L.DomEvent.disableScrollPropagation(map.getContainer()); }, [map]); return null; }
function MapClick({ onPick }: { onPick: (lat: number, lon: number) => void }) { useMapEvents({ click: ({ latlng }) => onPick(latlng.lat, latlng.lng) }); return null; }
function cachedPlace(key: string): Place[] | null { try { const value = sessionStorage.getItem(`place:${key.toLowerCase()}`); return value ? JSON.parse(value) as Place[] : null; } catch { return null; } }
async function geocodePlace(query: string): Promise<Place[]> { const cached = cachedPlace(query); if (cached) return cached; const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, { headers: { "Accept-Language": "en" } }); if (!response.ok) throw new Error("Unable to find that location"); const values = await response.json() as Array<{ display_name: string; lat: string; lon: string }>; const places = values.map((value) => ({ label: value.display_name, lat: Number(value.lat), lon: Number(value.lon) })); sessionStorage.setItem(`place:${query.toLowerCase()}`, JSON.stringify(places)); return places; }

export function LocationModal({ current, initial, onClose, onSelect }: { current: string; initial?: LocationPlace; onClose: () => void; onSelect: (location: LocationPlace) => void; }) {
  const [search, setSearch] = useState(current === "Current location" ? "" : current);
  const [draft, setDraft] = useState<Place | null>(initial ?? null);
  const [matches, setMatches] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(!initial);
  const [locationError, setLocationError] = useState("");
  const findPlace = async (event?: FormEvent) => {
    event?.preventDefault(); const query = search.trim(); if (!query) return;
    setLoading(true);
    try { const places = await geocodePlace(query); setMatches(places); if (places[0]) { setDraft(places[0]); setLocationError(""); } }
    catch { setLocationError("We couldn't find that location. Try a city, address, or postal code."); }
    finally { setLoading(false); }
  };
  const pickMapPoint = async (lat: number, lon: number) => {
    setMapLoading(true); setMatches([]); setLocationError("");
    try {
      const place = await reversePlace(lat, lon); setDraft(place); setSearch(place.label);
    } catch {
      const coordinatePlace = { label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
      setDraft(coordinatePlace); setSearch(coordinatePlace.label);
    } finally { setMapLoading(false); }
  };
  const useCurrent = () => {
    setMapLoading(true); setLocationError("");
    void getCurrentLocation().then(place => { setDraft(place); setSearch(place.label); setMatches([]); }).catch(error => setLocationError(error.message)).finally(() => setMapLoading(false));
  };
  useEffect(() => {
    if (initial) { setDraft(initial); setMapLoading(false); return; }
    let active = true;
    if (current === "Current location") {
      void getCurrentLocation().then(place => { if (active) setDraft(place); }).catch(error => { if (active) setLocationError(error.message); }).finally(() => { if (active) setMapLoading(false); });
    } else {
      void geocodePlace(current).then((places) => { if (active && places[0]) setDraft(places[0]); }).catch(() => { if (active) setLocationError("We couldn't locate the selected place on the map."); }).finally(() => { if (active) setMapLoading(false); });
    }
    return () => { active = false; };
  }, [current, initial]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="location-modal" role="dialog" aria-modal="true" aria-labelledby="location-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-title"><h2 id="location-title">Choose a location</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close location picker"><X /></button></div><form className="modal-search" onSubmit={findPlace}><Search size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search city, address, or postal code" /><button type="submit" aria-label="Search location" disabled={loading}>{loading ? "…" : "Search"}</button></form><button className="current-location-button" type="button" onClick={useCurrent}><Crosshair size={17} />Use my current location</button>{matches.length > 0 && <div className="location-suggestions">{matches.map((item) => <button type="button" key={`${item.lat}-${item.lon}`} onClick={() => { setDraft(item); setSearch(item.label); setMatches([]); setLocationError(""); }}><MapPin size={16} /><span>{item.label}</span></button>)}</div>}<div className="map-frame">{draft ? <MapContainer center={[draft.lat, draft.lon]} zoom={13} scrollWheelZoom touchZoom doubleClickZoom><ContainMapScroll /><Recenter place={draft} /><MapClick onPick={pickMapPoint} /><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Marker position={[draft.lat, draft.lon]} icon={pin} /></MapContainer> : <div className="map-placeholder"><Crosshair size={28} /><strong>{mapLoading ? "Finding your location…" : "Location unavailable"}</strong></div>}{mapLoading && draft && <div className="map-loading">Choosing location…</div>}</div><div className="map-help">{locationError || "Click anywhere on the map to choose that location."}</div>{draft && <div className="selected-location"><MapPin size={22} /><div><strong>{mapLoading ? "Finding address…" : draft.label}</strong><small>Search results will use this area</small></div></div>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" disabled={mapLoading || !draft} onClick={() => draft && onSelect(draft)}>Use this location</button></div></section></div>;
}
