export type DistanceUnit = "km" | "mi";

const mileLocations = /\b(?:united states|usa|u\.s\.|united kingdom|uk|u\.k\.|england|scotland|wales|northern ireland|liberia|myanmar)\b/i;

export function distanceUnitFor(location: string): DistanceUnit {
  return mileLocations.test(location) ? "mi" : "km";
}

export function displayDistance(miles: number, unit: DistanceUnit): string {
  const value = unit === "mi" ? miles : miles * 1.609344;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}
