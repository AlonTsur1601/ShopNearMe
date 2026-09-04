const cache = new Map();
const countryCurrencies = new Map([["IL","ILS"],["US","USD"],["GB","GBP"],["CA","CAD"],["AU","AUD"],["JP","JPY"],["CH","CHF"],["PL","PLN"],["DE","EUR"],["FR","EUR"],["IT","EUR"],["ES","EUR"],["NL","EUR"],["BE","EUR"],["AT","EUR"],["PT","EUR"],["IE","EUR"],["FI","EUR"],["GR","EUR"]]);
const countries = new Map([["israel","IL"],["united states","US"],["usa","US"],["canada","CA"],["united kingdom","GB"],["uk","GB"],["germany","DE"],["france","FR"],["italy","IT"],["spain","ES"],["netherlands","NL"],["australia","AU"],["japan","JP"],["switzerland","CH"],["poland","PL"]]);
function targetCurrency(location) {
  const text = String(location ?? "").toLowerCase();
  for (const [name, code] of countries) if (text.includes(name)) return countryCurrencies.get(code);
  return "USD";
}
async function rate(from, to) {
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  const key = from + "-" + to, cached = cache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch("https://api.frankfurter.dev/v2/rate/" + encodeURIComponent(from) + "/" + encodeURIComponent(to) + "?providers=ECB", { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json(), parsed = Number(data.rate);
    if (!Number.isFinite(parsed)) return null;
    const value = { rate: parsed, date: data.date };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch { return null; } finally { clearTimeout(timer); }
}
export async function localizeOffers(offers, location) {
  const target = targetCurrency(location), currencies = [...new Set(offers.map((offer) => offer.currency || "USD").filter((currency) => currency !== target))];
  const rates = new Map(await Promise.all(currencies.map(async (currency) => [currency, await rate(currency, target)])));
  return offers.map((offer) => {
    const source = offer.currency || "USD", conversion = rates.get(source);
    if (source === target || !conversion) return offer;
    const convert = (value) => value === null ? null : Math.round(value * conversion.rate * 100) / 100;
    return { ...offer, itemPrice: convert(offer.itemPrice), shippingPrice: convert(offer.shippingPrice), totalPrice: convert(offer.totalPrice), originalCurrency: source, currency: target, exchangeRateDate: conversion.date };
  });
}
