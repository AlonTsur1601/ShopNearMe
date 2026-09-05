export type LocationPlace = { label: string; lat: number; lon: number };

export async function reversePlace(lat: number, lon: number): Promise<LocationPlace> {
  const key = `place:reverse:${lat.toFixed(4)},${lon.toFixed(4)}`;
  try { const cached = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (cached?.[0]) return cached[0]; } catch { /* storage is optional */ }
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error("Unable to identify this location");
  const value = await response.json() as { display_name?: string; address?: Record<string, string> };
  const address = value.address;
  const city = address?.city || address?.town || address?.village || address?.municipality;
  const label = city && address?.country ? `${city}, ${address.country}` : value.display_name;
  const place = { label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
  try { sessionStorage.setItem(key, JSON.stringify([place])); } catch { /* storage is optional */ }
  return place;
}

// Search and the picker share one request and the same timeout/permission handling.
let pending: Promise<LocationPlace> | undefined;
export function getCurrentLocation(): Promise<LocationPlace> {
  if (pending) return pending;
  pending = new Promise<LocationPlace>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Location services are unavailable in this browser. Enter a city to search nearby stores.")); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = { lat: coords.latitude, lon: coords.longitude };
      void reversePlace(point.lat, point.lon).catch(() => ({ ...point, label: "Current location" })).then(resolve);
    }, (error) => reject(new Error(error.code === 1
      ? "Location permission is blocked. Allow location access for this site or enter a city to search nearby stores."
      : error.code === 3 ? "Finding your location timed out. Retry current location or enter a city."
        : "Your device could not determine its location. Retry current location or enter a city.")),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }).finally(() => { pending = undefined; });
  return pending;
}
