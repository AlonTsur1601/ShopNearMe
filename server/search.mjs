const cache = new Map();
const inFlight = new Map();
const CACHE_MS = 15 * 60 * 1000;
let ebayToken = null;

const colors = ["Black", "White", "Blue", "Red", "Green", "Silver", "Gold", "Gray", "Pink", "Brown", "Natural wood"];
const materials = ["Wood", "Metal", "Plastic", "Leather", "Glass", "Cotton", "Steel", "Aluminum", "Ceramic"];
const features = ["Wireless", "Bluetooth", "Waterproof", "Rechargeable", "Smart", "Portable", "Noise cancelling", "Organic", "Silent"];
const productRules = [
  { match: /clock/i, id: "clockType", label: "Clock type", values: ["Wall clock", "Alarm clock", "Desk clock", "Smart clock", "Mantel clock"] },
  { match: /clock/i, id: "movement", label: "Movement", values: ["Quartz", "Digital", "Mechanical", "Atomic"] },
  { match: /coffee|espresso/i, id: "type", label: "Coffee maker type", values: ["Drip", "Espresso", "Pod", "Single serve", "Cold brew", "French press"] },
  { match: /shoes?|sneakers?|boots?/i, id: "activity", label: "Activity", values: ["Running", "Trail", "Walking", "Hiking", "Basketball", "Training"] },
  { match: /laptop|notebook|chromebook/i, id: "platform", label: "Platform", values: ["Windows", "MacBook", "Chromebook", "Gaming"] },
  { match: /phone|smartphone/i, id: "network", label: "Network", values: ["Unlocked", "5G", "Dual SIM", "Prepaid"] },
  { match: /camera|lens/i, id: "cameraType", label: "Camera type", values: ["Mirrorless", "DSLR", "Instant", "Action", "Digital", "Film"] },
  { match: /vacuum/i, id: "vacuumType", label: "Vacuum type", values: ["Robot", "Cordless", "Upright", "Canister", "Handheld"] },
  { match: /chair|desk|table|sofa/i, id: "style", label: "Style", values: ["Modern", "Industrial", "Mid-century", "Rustic", "Minimalist"] },
];

const localStoreRules = [
  { match: /clock|watch/i, types: ["clock", "watch", "home goods", "furniture", "antique", "gift", "novelty", "department", "electronics"] },
  { match: /headphones?|earbuds?|speaker|audio/i, types: ["audio", "electronics", "computer", "department", "appliance", "music"] },
  { match: /shoes?|sneakers?|boots?|sandals?/i, types: ["shoe", "sporting goods", "department", "clothing", "outdoor"] },
  { match: /coffee|espresso|kettle|toaster|blender/i, types: ["appliance", "kitchen", "home goods", "department", "coffee"] },
  { match: /laptop|computer|keyboard|mouse|monitor|printer/i, types: ["computer", "electronics", "office supply", "department"] },
  { match: /phone|smartphone|tablet|charger/i, types: ["cell phone", "mobile phone", "electronics", "computer", "department"] },
  { match: /camera|lens|tripod/i, types: ["camera", "photography", "electronics", "department"] },
  { match: /vacuum|washer|dryer|refrigerator|microwave/i, types: ["appliance", "home goods", "department", "electronics"] },
  { match: /chair|desk|table|sofa|couch|bed|mattress/i, types: ["furniture", "office furniture", "home goods", "department"] },
  { match: /book|novel|textbook/i, types: ["book", "stationery", "department"] },
  { match: /toy|lego|doll|game/i, types: ["toy", "game", "hobby", "department"] },
  { match: /shirt|jacket|dress|jeans|clothing|pants/i, types: ["clothing", "fashion", "department"] },
];

const nonRetailTypes = /repair service|museum|tourist attraction|consultant|contractor|school|university|doctor|clinic|hospital|hotel|lawyer|accountant|real estate|software company|manufacturer/i;
const generalRetailTypes = /store|shop|retailer|market|mall|department|supermarket|pharmacy|hardware|supply/i;
const countryCodes = new Map([
  ["israel", "IL"], ["united states", "US"], ["usa", "US"], ["canada", "CA"], ["united kingdom", "GB"], ["uk", "GB"],
  ["germany", "DE"], ["france", "FR"], ["italy", "IT"], ["spain", "ES"], ["australia", "AU"], ["austria", "AT"],
  ["belgium", "BE"], ["netherlands", "NL"], ["ireland", "IE"], ["poland", "PL"], ["switzerland", "CH"],
]);

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function logoDataUri(name) {
  const initial = String(name || "S").trim().charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#eef8f8"/><text x="32" y="41" text-anchor="middle" font-family="Arial" font-size="30" font-weight="700" fill="#007b83">${initial.replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function safeHttpUrl(value, fallback = "") {
  try {
    const parsed = new URL(String(value ?? ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : fallback;
  } catch { return fallback; }
}

function includesWord(text, value) { return new RegExp(`\\b${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text); }
function inferValue(text, values) { return values.find((value) => includesWord(text, value)) ?? "Other"; }
function isUsed(item) { return /used|pre.?owned|refurb|renewed|open box|vintage|second.?hand|mercari|poshmark|offerup|back market/i.test(`${item.title ?? ""} ${item.condition ?? ""} ${item.badge ?? ""} ${item.source ?? ""}`); }
function isLocal(item) { return /(?:store|curbside|local)\s+pickup|pick\s*up\s+(?:today|in store)|in-store pickup/i.test(`${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`); }

function validCoordinates(coordinates) {
  const lat = Number(coordinates?.lat); const lon = Number(coordinates?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

function distanceMiles(origin, point) {
  const destination = validCoordinates(point); if (!origin || !destination) return undefined;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(destination.lat - origin.lat); const dLon = radians(destination.lon - origin.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localRelevance(place, query, origin) {
  const type = String(place.type ?? "").toLowerCase();
  const title = String(place.title ?? place.name ?? "").toLowerCase();
  const text = `${title} ${type}`;
  const distance = distanceMiles(origin, place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null);
  if (distance !== undefined && distance > 50) return -Infinity;
  if (nonRetailTypes.test(type) && !generalRetailTypes.test(type)) return -Infinity;

  let score = generalRetailTypes.test(type) ? 2 : 0;
  const rule = localStoreRules.find((candidate) => candidate.match.test(query));
  if (rule) {
    const typeMatches = rule.types.filter((value) => text.includes(value)).length;
    score += typeMatches * 4;
    if (typeMatches === 0) return -Infinity;
  }
  const queryWords = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  score += queryWords.filter((word) => text.includes(word)).length * 2;
  if (place.website || place.links?.website) score += 1;
  if ((number(place.rating) ?? 0) >= 4) score += 1;
  if ((number(place.reviews) ?? 0) >= 10) score += 1;
  if (distance !== undefined) score += Math.max(0, 2 - distance / 10);
  return score;
}

function parseShipping(item, itemPrice) {
  const text = `${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`;
  if (/free (delivery|shipping)/i.test(text)) return { shippingPrice: 0, totalPrice: itemPrice, shippingEstimated: false };
  const match = text.match(/(?:shipping|delivery)[^$]*\$([0-9]+(?:\.[0-9]{1,2})?)/i) ?? text.match(/\$([0-9]+(?:\.[0-9]{1,2})?)\s+(?:shipping|delivery)/i);
  const shippingPrice = match ? number(match[1]) : null;
  return { shippingPrice, totalPrice: itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : itemPrice, shippingEstimated: shippingPrice !== null };
}

function countryCodeFor(location) {
  const normalized = String(location ?? "").toLowerCase();
  for (const [name, code] of countryCodes) if (new RegExp(`(?:^|[,\\s])${name.replace(" ", "\\s+")}(?:$|[,\\s])`, "i").test(normalized)) return code;
  return null;
}

async function getEbayToken(credentials) {
  if (!credentials?.clientId || !credentials?.clientSecret) return null;
  if (ebayToken && ebayToken.expiresAt > Date.now() + 60_000) return ebayToken.value;
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!response.ok) throw new Error(`eBay OAuth returned ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error("eBay OAuth did not return an access token");
  ebayToken = { value: data.access_token, expiresAt: Date.now() + Math.max(60, number(data.expires_in) ?? 7200) * 1000 };
  return ebayToken.value;
}

function toEbayOffer(item, index) {
  const merchant = item.seller?.username ? `eBay · ${item.seller.username}` : "eBay";
  const price = item.price;
  const shipping = item.shippingOptions?.[0]?.shippingCost;
  const itemPrice = number(price?.convertedFromCurrency === "USD" ? price.convertedFromValue : price?.value);
  const shippingPrice = number(shipping?.convertedFromCurrency === "USD" ? shipping.convertedFromValue : shipping?.value);
  const totalPrice = itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : null;
  const condition = item.condition || "Used";
  const imageUrl = safeHttpUrl(item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl);
  return {
    id: `ebay-${item.itemId ?? index}`,
    category: "secondHand",
    merchant,
    merchantLogoUrl: "/ebay.svg",
    title: item.title || "Pre-owned eBay listing",
    subtitle: [condition, item.itemLocation?.country, item.buyingOptions?.join(" / ")].filter(Boolean).join(" · ") || "Pre-owned eBay listing",
    imageUrl,
    rating: number(item.seller?.feedbackPercentage) ? Math.min(5, number(item.seller.feedbackPercentage) / 20) : 0,
    reviewCount: number(item.seller?.feedbackScore) ?? 0,
    itemPrice,
    shippingPrice,
    totalPrice,
    shippingEstimated: false,
    priceVerified: totalPrice !== null,
    availability: "Available on eBay",
    condition,
    attributes: { condition, retailer: "eBay", seller: item.seller?.username || "eBay seller" },
    destinationUrl: safeHttpUrl(item.itemWebUrl || item.itemAffiliateWebUrl, "https://www.ebay.com/"),
  };
}

async function runEbaySearch(query, location, credentials) {
  const token = await getEbayToken(credentials);
  if (!token) return [];
  const filters = ["conditions:{USED}"];
  const country = countryCodeFor(location);
  if (country) filters.push(`deliveryCountry:${country}`);
  const params = new URLSearchParams({ q: query, limit: "15", filter: filters.join(",") });
  const headers = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
  if (country) headers["X-EBAY-C-ENDUSERCTX"] = `contextualLocation=country=${country}`;
  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, { headers });
  if (!response.ok) throw new Error(`eBay Browse API returned ${response.status}`);
  const data = await response.json();
  return (data.itemSummaries ?? []).map(toEbayOffer);
}

function toOffer(item, index, query) {
  const itemPrice = number(item.extracted_price ?? item.price);
  const shipping = parseShipping(item, itemPrice);
  const used = isUsed(item);
  const local = !used && isLocal(item);
  const merchant = item.source || item.merchant || item.seller || "Retailer";
  const text = `${item.title ?? ""} ${(item.extensions ?? []).join(" ")}`;
  const condition = used ? (item.condition || (/refurb|renewed/i.test(text) ? "Refurbished" : "Used")) : "New";
  const attributes = {
    condition,
    retailer: merchant,
    color: inferValue(text, colors),
    material: inferValue(text, materials),
    features: inferValue(text, features),
  };
  for (const rule of productRules) if (rule.match.test(`${query} ${text}`)) attributes[rule.id] = inferValue(text, rule.values);
  return {
    id: `serp-${item.product_id ?? item.position ?? index}`,
    category: used ? "secondHand" : local ? "local" : "order",
    merchant,
    merchantLogoUrl: safeHttpUrl(item.source_icon || item.favicon, logoDataUri(merchant)),
    title: item.title || "Product offer",
    subtitle: (item.extensions ?? []).slice(0, 3).join(" · ") || item.delivery || "See retailer for product details",
    imageUrl: safeHttpUrl(item.thumbnail || item.image),
    rating: number(item.rating) ?? 0,
    reviewCount: number(item.reviews) ?? 0,
    itemPrice,
    shippingPrice: local ? null : shipping.shippingPrice,
    totalPrice: local ? itemPrice : shipping.shippingPrice !== null ? shipping.totalPrice : null,
    shippingEstimated: shipping.shippingEstimated,
    priceVerified: itemPrice !== null && (local || shipping.shippingPrice !== null),
    availability: local ? "Check local stock" : "Available online",
    arrival: local ? undefined : item.delivery,
    condition,
    attributes,
    destinationUrl: safeHttpUrl(item.product_link || item.link || item.serpapi_product_api, "https://www.google.com/shopping"),
  };
}

function toLocalOffer(place, index, query, origin) {
  const merchant = place.title || place.name || "Local store";
  const itemPrice = number(place.extracted_price ?? place.product_price);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${merchant} ${place.address ?? ""}`)}`;
  const destinationUrl = safeHttpUrl(place.website || place.links?.website || place.link || place.directions, mapsUrl);
  const imageUrl = safeHttpUrl(place.thumbnail || place.image, logoDataUri(merchant));
  const point = place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null;
  return {
    id: `local-${place.place_id ?? place.data_id ?? place.position ?? index}`,
    category: "local",
    merchant,
    merchantLogoUrl: safeHttpUrl(place.favicon || place.source_icon, logoDataUri(merchant)),
    title: `${query} at ${merchant}`,
    subtitle: [place.type, place.address].filter(Boolean).join(" · ") || "Nearby store",
    imageUrl,
    rating: number(place.rating) ?? 0,
    reviewCount: number(place.reviews) ?? 0,
    itemPrice,
    shippingPrice: null,
    totalPrice: itemPrice,
    priceVerified: itemPrice !== null,
    availability: place.open_state || "Check product availability",
    distanceMiles: distanceMiles(origin, point),
    condition: "New",
    attributes: { condition: "New", retailer: merchant, storeType: place.type || "Store" },
    destinationUrl,
  };
}

function buildFacets(offers, query) {
  const specific = productRules.filter((rule) => rule.match.test(query)).map((rule) => [rule.id, rule.label]);
  const definitions = [["condition", "Condition"], ...specific, ["retailer", "Retailer"], ["color", "Color"], ["material", "Material"], ["features", "Features"]];
  return definitions.map(([id, label]) => {
    const counts = new Map();
    for (const offer of offers) { const value = offer.attributes[id]; if (value && value !== "Other") counts.set(value, (counts.get(value) ?? 0) + 1); }
    return { id, label, options: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value, count]) => ({ value, count })) };
  }).filter((facet) => facet.options.length > 0);
}

async function runShoppingSearch(query, location, apiKey) {
  const params = new URLSearchParams({ engine: "google_shopping", q: query, api_key: apiKey, hl: "en", num: "40" });
  if (location && location !== "Current location") params.set("location", location);
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  const raw = [...(data.shopping_results ?? []), ...(data.inline_shopping_results ?? [])];
  return raw.map((item, index) => toOffer(item, index, query));
}

async function runLocalSearch(query, location, apiKey, coordinates) {
  const origin = validCoordinates(coordinates);
  if (!origin && (!location || location === "Current location")) return [];
  const localQuery = origin ? `where to buy ${query}` : `where to buy ${query} near ${location}`;
  const params = new URLSearchParams({ engine: "google_maps", type: "search", q: localQuery, api_key: apiKey, hl: "en" });
  if (origin) params.set("ll", `@${origin.lat},${origin.lon},14z`);
  const response = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!response.ok) throw new Error(`SerpAPI local search returned ${response.status}`);
  const data = await response.json(); if (data.error) throw new Error(data.error);
  return (data.local_results ?? [])
    .map((place, index) => ({ place, index, relevance: localRelevance(place, query, origin) }))
    .filter(({ relevance }) => Number.isFinite(relevance) && relevance >= 2)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 10)
    .map(({ place, index }) => toLocalOffer(place, index, query, origin));
}

async function runSearch(query, location, apiKey, coordinates, ebayCredentials) {
  const [shopping, local, ebay] = await Promise.allSettled([
    runShoppingSearch(query, location, apiKey),
    runLocalSearch(query, location, apiKey, coordinates),
    runEbaySearch(query, location, ebayCredentials),
  ]);
  if (shopping.status === "rejected" && local.status === "rejected" && ebay.status === "rejected") throw shopping.reason;
  const shoppingOffers = shopping.status === "fulfilled" ? shopping.value : [];
  const localOffers = [...(local.status === "fulfilled" ? local.value : []), ...shoppingOffers.filter((offer) => offer.category === "local")].slice(0, 10);
  const orderOffers = shoppingOffers.filter((offer) => offer.category === "order").slice(0, 20);
  const secondHandOffers = [...(ebay.status === "fulfilled" ? ebay.value : []), ...shoppingOffers.filter((offer) => offer.category === "secondHand")].slice(0, 10);
  const combined = [...localOffers, ...orderOffers, ...secondHandOffers];
  const seen = new Set();
  const offers = combined.filter((offer) => offer.title && !seen.has(`${offer.category}|${offer.destinationUrl}`) && seen.add(`${offer.category}|${offer.destinationUrl}`)).slice(0, 40);
  return { query, resultCount: offers.length, offers, facets: buildFacets(offers, query), source: "live" };
}

export async function searchCatalog(query, location, apiKey, coordinates, ebayCredentials) {
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not configured");
  const point = validCoordinates(coordinates);
  const key = `${query.trim().toLowerCase()}|${String(location || "").trim().toLowerCase()}|${point ? `${point.lat.toFixed(4)},${point.lon.toFixed(4)}` : ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const request = runSearch(query.trim(), location, apiKey, point, ebayCredentials).then((value) => { cache.set(key, { at: Date.now(), value }); return value; }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
