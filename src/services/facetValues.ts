export function facetValues(value: string | string[] | undefined): string[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
export function matchesFacets(attributes: Record<string, string | string[]>, selected: Record<string, string[]>, available: Record<string, string[]> = {}): boolean {
  return Object.entries(selected).every(([id, values]) => !values.length
    || (!!available[id]?.length && available[id].every(value => values.includes(value)))
    || facetValues(attributes[id]).some(value => values.includes(value)));
}
