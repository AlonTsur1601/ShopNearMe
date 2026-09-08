import { AsyncLocalStorage } from "node:async_hooks";

const searches = new AsyncLocalStorage();
export const SEARCH_BUDGET_MS = 19000;
export function searchSignal(signal) {
  const budget = searches.getStore()?.controller.signal;
  return budget && signal ? AbortSignal.any([budget, signal]) : budget ?? signal;
}
export function captureOffer(offer) {
  const context = searches.getStore();
  if (!context || !offer || offer.availability === "Out of stock" || context.controller.signal.aborted) return offer;
  const key = `${offer.category}|${offer.destinationUrl}`;
  context.offers.set(key, offer);
  return offer;
}
export function captureStores(stores) {
  const context = searches.getStore();
  if (context && !context.controller.signal.aborted) context.stores = stores;
  return stores;
}
export async function withSearchBudget(operation, fallback) {
  const context = { controller: new AbortController(), offers: new Map(), stores: [] };
  return searches.run(context, async () => {
    let timer;
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        context.controller.abort();
        resolve(fallback([...context.offers.values()], context.stores));
      }, SEARCH_BUDGET_MS);
    });
    try { return await Promise.race([operation(), deadline]); }
    finally { clearTimeout(timer); context.controller.abort(); }
  });
}
