import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentLocation } from "./currentLocation";
function geolocation(getCurrentPosition: unknown) { vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } }); }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); });
describe("shared current location", () => {
  it("waits for the default device location beyond the old three-second cutoff and coalesces requests", async () => {
    vi.useFakeTimers();
    const get = vi.fn<Geolocation["getCurrentPosition"]>((success) => { setTimeout(() => success({ coords: { latitude: 32.08, longitude: 34.78 } } as GeolocationPosition), 4000); });
    geolocation(get);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ address: { city: "Tel Aviv", country: "Israel" } }) })));
    const a = getCurrentLocation(), b = getCurrentLocation();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(4001);
    expect(await a).toEqual({ label: "Tel Aviv, Israel", lat: 32.08, lon: 34.78 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][2]).toMatchObject({ timeout: 8000 });
  });
  it.each([[1, "permission is blocked"], [2, "could not determine"], [3, "timed out"]])("explains geolocation failure %s instead of saying no place was chosen", async (code, message) => {
    geolocation((_success: unknown, fail: (error: {code: number}) => void) => fail({ code }));
    await expect(getCurrentLocation()).rejects.toThrow(message);
  });
  it("preserves usable coordinates when reverse geocoding fails", async () => {
    geolocation((success: (value: unknown) => void) => success({ coords: { latitude: 32.09, longitude: 34.88 } }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Reverse unavailable")));
    expect(await getCurrentLocation()).toEqual({ label: "Current location", lat: 32.09, lon: 34.88 });
  });
});
