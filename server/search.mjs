import { enrichProductPage } from "./product-page.mjs";
import { localizeOffers } from "./currency.mjs";
import { monitorAttributes, specificationPairs, structuredAttributes } from "./specifications.mjs";
import { amountInCurrency, costBreakdown } from "./costs.mjs";
const cache = new Map(), inFlight = new Map();
const CACHE_MS = 15 * 60 * 1000;
let ebayToken = null;

const colors = ["Black", "White", "Blue", "Red", "Green", "Silver", "Gold", "Gray", "Pink", "Brown", "Natural wood"];
const materials = ["Solid wood", "Engineered wood", "Wood", "Glass", "Marble", "Stone", "Ceramic", "Metal", "Plastic", "Leather", "Steel", "Aluminum", "Cotton"];
const features = ["Wireless", "Bluetooth", "Wi-Fi", "Waterproof", "Water resistant", "Rechargeable", "Smart", "Portable", "Noise cancelling", "Foldable", "Adjustable", "Energy efficient", "Dishwasher safe", "Machine washable", "Silent", "Fast charging", "Remote control", "Touchscreen"];

function number(value) { if (typeof value === "number" && Number.isFinite(value)) return value; const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function includesPhrase(text, value) { return new RegExp(`(?:^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]")}(?:$|[^a-z0-9])`, "i").test(text); }
function inferValue(text, values) { return values.find((value) => includesPhrase(text, value)); }
function inferNumberBucket(text, pattern, buckets) { const value = number(text.match(pattern)?.[1]); return value === null ? undefined : buckets.find(([max]) => value <= max)?.[1]; }
function inferTableSize(text) { const seats = text.match(/(?:seats?|for)\s*(\d+)|(?:^|\D)(\d+)\s*(?:person|people|seater)/i); const count = number(seats?.[1] ?? seats?.[2]); if (count !== null) return count <= 2 ? "2 seats" : count <= 4 ? "4 seats" : count <= 6 ? "6 seats" : "8+ seats"; return inferNumberBucket(text, /(?:^|\D)(\d{2,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|")/i, [[47, "Compact (under 48 in)"], [71, "Standard (48–71 in)"], [Infinity, "Large (72+ in)"]]); }
function inferChairs(text) { return /table only|without chairs|chairs not included/i.test(text) ? "Table only" : /(?:with|includes?)\s+(?:\d+\s+)?chairs?|table\s*(?:&|and)\s*(?:\d+\s+)?chairs?/i.test(text) ? "Includes chairs" : undefined; }
function inferExtendable(text) { return /non[- ]extendable|not extendable|fixed(?:[- ]length| top)? table|fixed dining table/i.test(text) ? "Fixed" : /extendable|extending|extension|expandable|drop[- ]leaf|butterfly[- ]leaf/i.test(text) ? "Extendable" : undefined; }
function inferScreen(text) { const match = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|"|''|אינץ)/i) || text.match(/"(\d{1,3}(?:\.\d+)?)\b/); return match ? `${match[1]} in` : undefined; }
function inferStorage(text, qualifier = "") { const pattern = qualifier ? new RegExp(`\\b(\\d+)\\s*(GB|TB)\\s+${qualifier}\\b`, "i") : /\b(\d+)\s*(GB|TB)\b/i; const match = text.match(pattern); return match ? `${match[1]} ${match[2].toUpperCase()}` : undefined; }
function inferShoeSize(text) { const match = text.match(/(?:size|US)\s*(\d{1,2}(?:\.5)?)/i); return match ? `US ${match[1]}` : undefined; }
function inferWattage(text) { const match = text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i); if (!match) return undefined; const value = number(match[1]); return value === null ? undefined : value < 500 ? "Under 500 W" : value < 700 ? "500–699 W" : value < 900 ? "700–899 W" : value < 1200 ? "900–1199 W" : "1200 W+"; }
function inferResolution(text) {
  return /8k|7680\s*[x×]\s*4320/i.test(text) ? "8K" : /4k|uhd|3840\s*[x×]\s*2160/i.test(text) ? "4K" : /1440p|(?:w?qhd)|2560\s*[x×]\s*1440|3440\s*[x×]\s*1440/i.test(text) ? "1440p" : /1080p|fhd|full hd|1920\s*[x×]\s*1080/i.test(text) ? "1080p" : undefined;
}
function inferPanel(text) { return /qd[- ]?oled/i.test(text) ? "QD-OLED" : /w[- ]?oled/i.test(text) ? "WOLED" : /oled/i.test(text) ? "OLED" : /mini[- ]?led/i.test(text) ? "Mini-LED" : inferValue(text, ["QLED", "IPS", "VA", "TN", "LED", "LCD"]); }
function inferUnit(text, pattern, unit) { const value = text.match(pattern)?.[1]; return value ? `${Number(value)} ${unit}` : undefined; }
function inferBoolean(text, yes, no, yesLabel, noLabel) { return yes.test(text) ? yesLabel : no.test(text) ? noLabel : undefined; }

const productRules = [
  { match: /dining\s+(?:table|set)/i, rules: [{ id: "tableSize", label: "Size / seats", infer: inferTableSize }, { id: "material", label: "Material", values: materials }, { id: "shape", label: "Shape", values: ["Rectangular", "Round", "Oval", "Square"] }, { id: "chairsIncluded", label: "Chairs included", infer: inferChairs }, { id: "extendable", label: "Extendable", infer: inferExtendable }] },
  { match: /clock/i, rules: [{ id: "clockType", label: "Clock type", values: ["Wall clock", "Alarm clock", "Desk clock", "Smart clock", "Mantel clock"] }, { id: "movement", label: "Movement", values: ["Quartz", "Digital", "Mechanical", "Atomic"] }] },
  { match: /coffee\s+(?:maker|machine)|espresso|french press/i, rules: [{ id: "type", label: "Coffee maker type", values: ["Drip", "Espresso", "Pod", "Single serve", "Cold brew", "French press"] }] },
  { match: /shoes?|sneakers?|boots?/i, rules: [{ id: "activity", label: "Activity", values: ["Running", "Trail", "Walking", "Hiking", "Basketball", "Training"] }, { id: "shoeSize", label: "Size", infer: inferShoeSize }] },
  { match: /laptop|notebook|chromebook/i, rules: [{ id: "platform", label: "Platform", values: ["Windows", "MacBook", "Chromebook", "Gaming"] }, { id: "screenSize", label: "Screen size", infer: inferScreen }, { id: "memory", label: "Memory", infer: (text) => inferStorage(text, "RAM") }, { id: "storage", label: "Storage", infer: inferStorage }] },
  { match: /\b(?:phone|smartphone)s?\b/i, rules: [{ id: "network", label: "Network", values: ["Unlocked", "5G", "Dual SIM", "Prepaid"] }, { id: "storage", label: "Storage", infer: inferStorage }, { id: "screenSize", label: "Screen size", infer: inferScreen }] },
  { match: /camera|lens/i, rules: [{ id: "cameraType", label: "Camera type", values: ["Mirrorless", "DSLR", "Instant", "Action", "Digital", "Film"] }] },
  { match: /vacuum/i, rules: [{ id: "vacuumType", label: "Vacuum type", values: ["Robot", "Cordless", "Upright", "Canister", "Handheld"] }, { id: "features", label: "Features", values: features }] },
  { match: /(?:television|\btv\b|monitor)/i, rules: [{ id: "screenSize", label: "Screen size", infer: inferScreen }, { id: "displayType", label: "Panel type", infer: inferPanel }, { id: "resolution", label: "Resolution", infer: inferResolution }, { id: "refreshRate", label: "Refresh rate", infer: (text) => inferUnit(text, /\b(\d{2,3})\s*hz\b/i, "Hz") }, { id: "responseTime", label: "Response time", infer: (text) => inferUnit(text, /\b(\d+(?:\.\d+)?)\s*ms\b/i, "ms") }, { id: "curvature", label: "Screen shape", values: ["Curved", "Flat"] }, { id: "aspectRatio", label: "Aspect ratio", infer: (text) => text.match(/\b(16:9|16:10|21:9|32:9)\b/)?.[1] }, { id: "hdr", label: "HDR", infer: (text) => text.match(/\b(?:Display)?HDR\s*(True Black\s*)?(\d{3,4})\b/i)?.[0] }, { id: "adaptiveSync", label: "Adaptive sync", values: ["FreeSync Premium Pro", "FreeSync Premium", "FreeSync", "G-Sync"] }] },
  { match: /drill|impact driver|power tool/i, rules: [{ id: "toolType", label: "Tool type", values: ["Drill driver", "Hammer drill", "Impact driver", "Rotary hammer"] }, { id: "voltage", label: "Voltage", infer: (text) => text.match(/\b(\d{1,2})\s*V\b/i)?.[1] ? `${text.match(/\b(\d{1,2})\s*V\b/i)[1]} V` : undefined }, { id: "chuckSize", label: "Chuck size", infer: (text) => text.match(/\b(1\/4|3\/8|1\/2)\s*(?:in(?:ch)?|")/i)?.[1] ? `${text.match(/\b(1\/4|3\/8|1\/2)\s*(?:in(?:ch)?|")/i)[1]} in` : undefined }, { id: "battery", label: "Battery", infer: (text) => /bare tool|tool only/i.test(text) ? "Tool only" : /battery included|with battery|\d+\.\d+\s*Ah/i.test(text) ? "Battery included" : undefined }, { id: "motor", label: "Motor", values: ["Brushless", "Brushed"] }] },
  { match: /printer/i, rules: [{ id: "printerType", label: "Printer type", values: ["Laser", "Inkjet", "Thermal", "All-in-one"] }, { id: "printing", label: "Printing", values: ["Color", "Monochrome"] }, { id: "duplex", label: "Two-sided printing", values: ["Auto duplex", "Manual duplex"] }] },
  { match: /mattress/i, rules: [{ id: "size", label: "Size", values: ["Twin", "Twin XL", "Full", "Queen", "King", "California King"] }, { id: "firmness", label: "Firmness", values: ["Soft", "Medium", "Firm"] }, { id: "mattressType", label: "Type", values: ["Memory foam", "Hybrid", "Innerspring", "Latex"] }] },
  { match: /bike|bicycle/i, rules: [{ id: "bikeType", label: "Bike type", values: ["Road", "Mountain", "Hybrid", "Electric", "BMX"] }, { id: "wheelSize", label: "Wheel size", infer: (text) => text.match(/\b(\d{2}(?:\.\d+)?)\s*(?:in(?:ch)?|")\s*wheel/i)?.[1] ? `${text.match(/\b(\d{2}(?:\.\d+)?)\s*(?:in(?:ch)?|")\s*wheel/i)[1]} in` : undefined }] },
  { match: /(?:power supply|\bpsu\b)/i, rules: [{ id: "wattage", label: "Wattage", infer: inferWattage }, { id: "efficiency", label: "Efficiency rating", values: ["80 Plus Titanium", "80 Plus Platinum", "80 Plus Gold", "80 Plus Silver", "80 Plus Bronze", "80 Plus"] }, { id: "modularity", label: "Cable management", values: ["Fully modular", "Semi modular", "Non modular"] }, { id: "formFactor", label: "Form factor", values: ["ATX", "SFX-L", "SFX", "TFX"] }, { id: "pcie", label: "PCIe support", values: ["PCIe 5.1", "PCIe 5.0", "PCIe 4.0"] }] },
  { match: /headphones?|earbuds?|headset/i, rules: [{ id: "audioType", label: "Type", values: ["Over-ear", "On-ear", "In-ear", "Earbuds", "Gaming headset"] }, { id: "connectivity", label: "Connectivity", values: ["Bluetooth", "Wireless", "Wired", "USB-C", "3.5 mm"] }, { id: "noiseCancellation", label: "Noise control", values: ["Active noise cancelling", "Noise cancelling", "Noise isolating", "Transparency mode"] }, { id: "microphone", label: "Microphone", infer: (text) => inferBoolean(text, /built[- ]in mic|with microphone|headset/i, /without microphone|no mic/i, "Microphone included", "No microphone") }] },
  { match: /keyboard|mouse/i, rules: [{ id: "deviceType", label: "Device type", values: ["Keyboard and mouse", "Keyboard", "Mouse"] }, { id: "connectivity", label: "Connectivity", values: ["Bluetooth", "Wireless", "Wired", "USB-C"] }, { id: "switchType", label: "Switch type", values: ["Mechanical", "Membrane", "Optical", "Linear", "Tactile", "Clicky"] }, { id: "layout", label: "Layout", values: ["Full size", "Tenkeyless", "75%", "65%", "60%"] }] },
  { match: /(?:ssd|hard drive|storage drive|flash drive)/i, rules: [{ id: "driveType", label: "Drive type", values: ["NVMe", "SATA SSD", "External SSD", "Hard drive", "USB flash drive"] }, { id: "storage", label: "Capacity", infer: inferStorage }, { id: "interface", label: "Interface", values: ["PCIe 5.0", "PCIe 4.0", "PCIe 3.0", "SATA", "USB-C", "USB 3.0"] }] },
  { match: /jacket|shirt|dress|pants|jeans|clothing/i, rules: [{ id: "clothingSize", label: "Size", values: ["XXS", "XS", "Small", "Medium", "Large", "XL", "XXL", "3XL"] }, { id: "fit", label: "Fit", values: ["Slim fit", "Regular fit", "Relaxed fit", "Oversized"] }, { id: "material", label: "Material", values: materials }] },
  { match: /(?:office|coffee|side|console)\s+table|chair|desk|sofa|couch/i, rules: [{ id: "material", label: "Material", values: materials }, { id: "shape", label: "Shape", values: ["Rectangular", "Round", "Oval", "Square"] }] },
];
const storeRules = [
  [/clock|watch/i, ["clock", "watch", "home goods", "furniture", "antique", "gift", "department", "electronics"]],
  [/headphones?|earbuds?|speaker|audio/i, ["audio", "electronics", "computer", "department", "appliance", "music"]],
  [/shoes?|sneakers?|boots?|sandals?/i, ["shoe", "sporting goods", "department", "clothing", "outdoor"]],
  [/coffee|espresso|kettle|toaster|blender/i, ["appliance", "kitchen", "home goods", "department", "coffee"]],
  [/laptop|computer|keyboard|mouse|monitor|printer/i, ["computer", "electronics", "office supply", "department"]],
  [/(?:power supply|\bpsu\b|graphics card|motherboard)/i, ["computer", "electronics", "hardware", "department"]],
  [/phone|smartphone|tablet|charger/i, ["cell phone", "mobile phone", "electronics", "computer", "department"]],
  [/camera|lens|tripod/i, ["camera", "photography", "electronics", "department"]],
  [/vacuum|washer|dryer|refrigerator|microwave/i, ["appliance", "home goods", "department", "electronics"]],
  [/chair|desk|table|sofa|couch|bed|mattress/i, ["furniture", "office furniture", "home goods", "department"]],
  [/book|novel|textbook/i, ["book", "stationery", "department"]], [/toy|lego|doll|game/i, ["toy", "game", "hobby", "department"]], [/shirt|jacket|dress|jeans|clothing|pants/i, ["clothing", "fashion", "department"]],
];
const nonRetail = /repair service|museum|tourist attraction|consultant|contractor|school|university|doctor|clinic|hospital|hotel|lawyer|accountant|real estate|software company|manufacturer/i;
const generalRetail = /store|shop|retailer|market|mall|department|supermarket|pharmacy|hardware|supply/i;
const excludedHosts = /(?:amazon|ebay|etsy|facebook|pinterest|aliexpress|temu|wikipedia)\./i;
const countries = new Map([["israel", "IL"], ["united states", "US"], ["usa", "US"], ["canada", "CA"], ["united kingdom", "GB"], ["uk", "GB"], ["germany", "DE"], ["france", "FR"], ["italy", "IT"], ["spain", "ES"], ["australia", "AU"]]);
const countryTlds = new Map([["IL", ".il"], ["GB", ".uk"], ["CA", ".ca"], ["DE", ".de"], ["FR", ".fr"], ["IT", ".it"], ["ES", ".es"], ["AU", ".au"]]);

export function safeHttpUrl(value, fallback = "") { try { const decoded = String(value ?? "").replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/\\\//g, "/"); const parsed = new URL(decoded); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : fallback; } catch { return fallback; } }
function searchTokens(value) { const stop = new Set(["a", "an", "and", "at", "best", "buy", "cheap", "deals", "for", "in", "near", "of", "on", "price", "sale", "the", "to", "with"]); return [...new Set(String(value).toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, " ").split(/\s+/).filter((token) => token.length > 1 && !stop.has(token)).map((token) => token.replace(/(?:ies|es|s)$/i, (ending) => ending === "ies" ? "y" : "")))]; }
const translatedCategories = [
  [/monitor|television|\btv\b/i, /מס[ךכ]/, "מסך"], [/headphones?|earbuds?/i, /אוזני[וה]ת/, "אוזניות"],
  [/dining\s+(?:table|set)/i, /שולח[ןנות]|פינת אוכל/, "שולחן אוכל"], [/clock/i, /שעו[ןנים]/, "שעון"],
  [/power supply|\bpsu\b/i, /ספק.*כ[ו]?ח/, "ספק כוח"], [/laptop|notebook/i, /מחשב.*נייד/, "מחשב נייד"],
  [/vacuum/i, /שואב/, "שואב אבק"], [/printer/i, /מדפסת/, "מדפסת"], [/phone|smartphone/i, /טלפון/, "טלפון"],
  [/chair/i, /כיסא|כסא/, "כיסא"], [/desk/i, /שולחן/, "שולחן"], [/camera/i, /מצלמה/, "מצלמה"],
];
export function isRelevantProduct(title, query) {
  if (/monitor|television|\btv\b/i.test(query)) {
    const wantedPanel = inferPanel(query), actualPanel = inferPanel(title);
    if (wantedPanel && actualPanel && !(wantedPanel === "OLED" ? actualPanel.includes("OLED") : actualPanel === wantedPanel)) return false;
    const wantedResolution = inferResolution(query), actualResolution = inferResolution(title);
    if (wantedResolution && actualResolution && wantedResolution !== actualResolution) return false;
  }
  const category = productRules.find((group) => group.match.test(query));
  const translated = translatedCategories.find(([match]) => match.test(query));
  if (category?.match.test(title) || translated?.[1].test(title)) return true;
  const wanted = searchTokens(query), actual = searchTokens(title);
  if (!wanted.length) return false;
  const matched = wanted.filter((token) => actual.some((value) => value === token || (token.length >= 5 && (value.startsWith(token) || token.startsWith(value)))));
  return wanted.length === 1 ? matched.length === 1 : matched.length >= Math.min(2, wanted.length);
}
function localQuery(query, code) {
  if (code !== "IL") return query;
  const translated = translatedCategories.find(([match]) => match.test(query));
  return translated ? query.replace(translated[0], translated[2]).replace(/1440p/ig, "2560x1440") : query;
}
export function providerLocation(location) {
  const parts = String(location ?? "").split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length <= 3) return parts.join(", ");
  const administrative = parts.findIndex(p => /subdistrict|district|county|region/i.test(p));
  const city = administrative > 0 ? parts[administrative - 1] : parts[parts.length - 3];
  return [city, parts.at(-1)].join(", ");
}
export function shortRetailerName(value) { return String(value || "Retailer").split(/\s(?:[-–—|·]|:\s)\s/)[0].replace(/\s+(?:ישראל(?:\s+אתר\s+היבואן\s+הרשמי)?|אתר\s+היבואן\s+הרשמי|היבואן\s+הרשמי|official\s+(?:site|store)|israel)$/iu, "").trim() || "Retailer"; }
const genericRules = [
  { id: "brand", label: "Brand", infer: (_text, meta) => meta?.brand }, { id: "color", label: "Color", values: colors }, { id: "material", label: "Material", values: materials }, { id: "features", label: "Features", values: features },
  { id: "dimensions", label: "Dimensions", infer: (text) => text.match(/\b(\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?(?:\s*(?:x|×)\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|in(?:ches)?|"))/i)?.[1] },
  { id: "capacity", label: "Capacity", infer: (text) => text.match(/\b(\d+(?:\.\d+)?\s*(?:ml|l|liters?|oz|cups?|quarts?))\b/i)?.[1] },
  { id: "power", label: "Power", infer: (text) => text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i)?.[1] ? `${text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i)[1]} W` : undefined },
  { id: "packSize", label: "Pack size", infer: (text) => text.match(/\b(\d+)\s*(?:pack|count|ct|pieces?)\b/i)?.[1] ? `${text.match(/\b(\d+)\s*(?:pack|count|ct|pieces?)\b/i)[1]} pack` : undefined },
  { id: "storage", label: "Storage", infer: inferStorage },
  { id: "connectivity", label: "Connectivity", values: ["Bluetooth", "Wi-Fi", "Wired", "USB-C", "Lightning", "HDMI"] },
  { id: "weight", label: "Weight", infer: (text) => text.match(/\b(\d+(?:\.\d+)?\s*(?:kg|g|lb|lbs|oz))\b/i)?.[1] },
];
function rulesFor(query) { return [...(productRules.find((group) => group.match.test(query))?.rules ?? []), ...genericRules]; }
function attributesFor(query, text, condition, merchant, meta = {}) {
  text = `${text} ${meta.specificationText ?? ""}`;
  const attributes = { condition, retailer: shortRetailerName(merchant) };
  for (const rule of rulesFor(query)) {
    if (attributes[rule.id]) continue;
    const value = rule.infer ? rule.infer(text, meta) : rule.values.filter(value => includesPhrase(text, value)).filter((value, _, matches) => !matches.some(other => other !== value && includesPhrase(other, value)));
    if (value && (!Array.isArray(value) || value.length)) attributes[rule.id] = Array.isArray(value) && value.length === 1 ? value[0] : value;
  }
  const result = { ...attributes, ...monitorAttributes(query, text).attributes, ...structuredAttributes(meta.specifications).attributes };
  if (result.brand) result.brand = Array.isArray(result.brand) ? result.brand.map(value => value.toUpperCase()) : result.brand.toUpperCase();
  return result;
}
function attributeLabelsFor(query, text, meta = {}) { return { ...monitorAttributes(query, text).labels, ...structuredAttributes(meta.specifications).labels }; }
function used(item) { return /used|pre.?owned|refurb|renewed|open box|vintage|second.?hand|mercari|poshmark|offerup|back market/i.test(`${item.title ?? ""} ${item.condition ?? ""} ${item.badge ?? ""} ${item.source ?? ""}`); }
function local(item) { return /(?:store|curbside|local)\s+pickup|pick\s*up\s+(?:today|in store)|in-store pickup/i.test(`${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`); }
function validCoordinates(value) { const lat = Number(value?.lat), lon = Number(value?.lon); return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; }
function distanceMiles(origin, point) { const destination = validCoordinates(point); if (!origin || !destination) return undefined; const rad = (value) => value * Math.PI / 180, dLat = rad(destination.lat - origin.lat), dLon = rad(destination.lon - origin.lon); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origin.lat)) * Math.cos(rad(destination.lat)) * Math.sin(dLon / 2) ** 2; return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function relevance(place, query, origin) { const type = String(place.type ?? "").toLowerCase(), text = `${place.title ?? ""} ${type}`.toLowerCase(), distance = distanceMiles(origin, place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null); if ((distance !== undefined && distance > 50) || (nonRetail.test(type) && !generalRetail.test(type))) return -Infinity; let score = generalRetail.test(type) ? 2 : 0; const rule = storeRules.find(([match]) => match.test(query)); if (rule) { const matches = rule[1].filter((value) => text.includes(value)).length; if (!matches) return -Infinity; score += matches * 4; } return score + (place.website ? 1 : 0) + (distance === undefined ? 0 : Math.max(0, 2 - distance / 10)); }
function shippingFor(item, itemPrice) { const text = `${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`; if (/free (delivery|shipping)/i.test(text)) return { shippingPrice: 0, totalPrice: itemPrice, shippingEstimated: false }; const match = text.match(/(?:shipping|delivery)[^$]*\$([0-9]+(?:\.[0-9]{1,2})?)/i); const shippingPrice = match ? number(match[1]) : null; return { shippingPrice, totalPrice: itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : itemPrice, shippingEstimated: shippingPrice !== null }; }
function countryCode(location) { const text = String(location ?? "").toLowerCase(); for (const [name, code] of countries) if (text.includes(name)) return code; return null; }
function isLocalResult(url, item, location) { const code = countryCode(location); if (!code || code === "US") return true; const tld = countryTlds.get(code), text = `${item.title ?? ""} ${item.snippet ?? ""} ${item.price ?? ""} ${item.displayed_link ?? ""}`; if (tld && url.hostname.endsWith(tld)) return true; if (code === "IL") return /[\u0590-\u05ff]|₪|\bILS\b|\bIsrael\b/i.test(text); return String(location).toLowerCase().split(/[,\s]+/).filter((part) => part.length > 3).some((part) => text.toLowerCase().includes(part)); }
async function fetchJson(url, options = {}, timeoutMs = 10000) { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(url, { ...options, signal: controller.signal }); const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || `Provider returned ${response.status}`); return data; } finally { clearTimeout(timer); } }

async function ebayAccess(credentials) { if (!credentials?.clientId || !credentials?.clientSecret) return null; if (ebayToken?.expiresAt > Date.now() + 60000) return ebayToken.value; const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64"); const data = await fetchJson("https://api.ebay.com/identity/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }) }); ebayToken = { value: data.access_token, expiresAt: Date.now() + (number(data.expires_in) ?? 7200) * 1000 }; return data.access_token; }
async function ebaySearch(query, location, credentials) { const token = await ebayAccess(credentials); if (!token) return []; const country = countryCode(location), filters = ["conditions:{USED}"]; if (country) filters.push(`deliveryCountry:${country}`); const params = new URLSearchParams({ q: query, limit: "15", filter: filters.join(",") }), headers = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" }; if (country) headers["X-EBAY-C-ENDUSERCTX"] = `contextualLocation=country=${country}`; const data = await fetchJson(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, { headers }, 8000); const items = data.itemSummaries ?? []; await Promise.all(items.slice(0, 4).map(async item => { if (!item.itemId) return; try { const detail = await fetchJson(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(item.itemId)}`, { headers }, 5000); item.specifications = specificationPairs(detail.localizedAspects); item.shippingOptions = detail.shippingOptions ?? item.shippingOptions; item.importCharges = detail.importCharges ?? item.importCharges; if (detail.brand) item.specifications.push({ name: "Manufacturer", value: detail.brand }); } catch { /* Basic offers remain available when detail enrichment fails. */ } })); return items.filter((item) => isRelevantProduct(item.title, query)).map((item, index) => { const price = item.price, shipping = item.shippingOptions?.[0]?.shippingCost, itemPrice = number(price?.convertedFromCurrency === "USD" ? price.convertedFromValue : price?.value), shippingPrice = number(shipping?.convertedFromCurrency === "USD" ? shipping.convertedFromValue : shipping?.value), totalPrice = itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : itemPrice, condition = item.condition || "Used", merchant = "eBay"; return { id: `ebay-${item.itemId ?? index}`, category: "secondHand", merchant, merchantLogoUrl: "/ebay.svg", title: item.title || "Pre-owned eBay listing", subtitle: [condition, item.itemLocation?.country].filter(Boolean).join(" · "), imageUrl: safeHttpUrl(item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl), rating: number(item.seller?.feedbackPercentage) ? Math.min(5, number(item.seller.feedbackPercentage) / 20) : 0, reviewCount: number(item.seller?.feedbackScore) ?? 0, itemPrice, shippingPrice, totalPrice, currency: price?.convertedFromCurrency === "USD" ? "USD" : price?.currency || "USD", ...costBreakdown({ itemPrice, shippingPrice, importTaxPrice: amountInCurrency(item.shippingOptions?.[0]?.importCharges ?? item.importCharges, price?.convertedFromCurrency === "USD" ? "USD" : price?.currency || "USD"), crossBorder: !!country && !!item.itemLocation?.country && item.itemLocation.country !== country }), priceVerified: totalPrice !== null, availability: "Available on eBay", condition, attributes: attributesFor(query, item.title || "", condition, "eBay", item), attributeLabels: attributeLabelsFor(query, item.title || "", item), destinationUrl: safeHttpUrl(item.itemWebUrl), linkLabel: "View product" }; }).filter((offer) => offer.destinationUrl); }
function shoppingOffer(item, index, query) { if (!isRelevantProduct(item.title, query) || !safeHttpUrl(item.link || item.product_link)) return null; const itemPrice = number(item.extracted_price ?? item.price), shipping = shippingFor(item, itemPrice), isUsed = used(item), isLocal = !isUsed && local(item), merchant = shortRetailerName(item.source || item.merchant || item.seller || "Retailer"), text = `${item.title ?? ""} ${(item.extensions ?? []).join(" ")}`, condition = isUsed ? (item.condition || (/refurb|renewed/i.test(text) ? "Refurbished" : "Used")) : "New", shippingPrice = isLocal ? null : shipping.shippingPrice; return { id: `serp-${item.product_id ?? item.position ?? index}`, category: isUsed ? "secondHand" : isLocal ? "local" : "order", merchant, merchantLogoUrl: safeHttpUrl(item.source_icon || item.favicon), title: item.title || "Product offer", subtitle: (item.extensions ?? []).slice(0, 3).join(" · ") || item.delivery || "See retailer for product details", imageUrl: safeHttpUrl(item.thumbnail || item.image), rating: number(item.rating) ?? 0, reviewCount: number(item.reviews) ?? 0, itemPrice, shippingPrice, totalPrice: itemPrice === null ? null : shippingPrice === null ? itemPrice : shipping.totalPrice, currency: /₪|NIS|ILS/i.test(`${item.price ?? ""} ${text}`) ? "ILS" : /€|EUR/i.test(`${item.price ?? ""} ${text}`) ? "EUR" : /£|GBP/i.test(`${item.price ?? ""} ${text}`) ? "GBP" : "USD", shippingEstimated: shipping.shippingEstimated, priceVerified: itemPrice !== null, availability: isLocal ? "Check local stock" : "Available online", arrival: isLocal ? undefined : item.delivery, condition, attributes: attributesFor(query, text, condition, merchant), destinationUrl: safeHttpUrl(item.link || item.product_link), linkLabel: "View product" }; }
function mapOffer(place, index, query, origin) { const merchant = place.title || place.name || "Local store", itemPrice = number(place.extracted_price ?? place.product_price), point = place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null; return { id: `local-${place.place_id ?? place.data_id ?? index}`, category: "local", merchant, merchantLogoUrl: safeHttpUrl(place.favicon), title: `${query} at ${merchant}`, subtitle: [place.type, place.address].filter(Boolean).join(" · ") || "Nearby store", imageUrl: "", rating: number(place.rating) ?? 0, reviewCount: number(place.reviews) ?? 0, itemPrice, shippingPrice: null, totalPrice: itemPrice, currency: "USD", priceVerified: itemPrice !== null, availability: place.open_state || "Check product availability", distanceMiles: distanceMiles(origin, point), condition: "New", attributes: { condition: "New", retailer: shortRetailerName(merchant) }, destinationUrl: safeHttpUrl(place.website || place.links?.directions || place.google_maps_url), linkLabel: "View store" }; }
function explicitCurrency(text) { return /₪|\bNIS\b|\bILS\b/i.test(text) ? "ILS" : /€|\bEUR\b/i.test(text) ? "EUR" : /£|\bGBP\b/i.test(text) ? "GBP" : /\$|\bUSD\b/i.test(text) ? "USD" : null; }
function localPrice(text, extracted) { const direct = number(extracted); if (direct !== null) return { value: direct, currency: explicitCurrency(text) ?? "USD" }; const ils = text.match(/(?:₪|NIS|ILS)\s*([0-9][0-9,.]*)|([0-9][0-9,.]*)\s*(?:₪|NIS|ILS)/i); if (ils) return { value: number(ils[1] ?? ils[2]), currency: "ILS" }; const usd = text.match(/\$\s*([0-9][0-9,.]*)/); return usd ? { value: number(usd[1]), currency: "USD" } : { value: null, currency: "USD" }; }
async function localProduct(item, index, query, location) { const link = safeHttpUrl(item.link); if (!link || isCategoryPage(item.title, link) || !isRelevantProduct(item.title, query)) return null; const url = new URL(link); if (excludedHosts.test(url.hostname) || url.pathname === "/" || /\/cat(?:\/|\b)|models\.aspx|[?&]act=cat\b/i.test(link) || /zap\.co\.il$/i.test(url.hostname) || !isLocalResult(url, item, location)) return null; const snippet = `${item.title ?? ""} ${item.snippet ?? ""} ${item.price ?? ""} ${(item.rich_snippet?.top?.extensions ?? []).join(" ")}`, page = await enrichProductPage(link), title = page.title || item.title; if (page.isCatalog || isCategoryPage(title, link) || !isRelevantProduct(title, query)) return null; const fallback = localPrice(snippet, item.extracted_price), itemPrice = page.price ?? fallback.value, currency = explicitCurrency(snippet) ?? (page.price !== null && page.price !== undefined ? page.currency : fallback.currency), merchant = shortRetailerName(item.source || item.displayed_link?.split(" › ")[0] || url.hostname.replace(/^www\./, "").split(".")[0]); return { id: `local-product-${index}-${url.hostname}`, category: "local", merchant, merchantLogoUrl: safeHttpUrl(item.favicon), title, subtitle: String(item.snippet ?? "").slice(0, 150) || `Available near ${location}`, imageUrl: page.imageUrl || safeHttpUrl(item.thumbnail || item.image), rating: 0, reviewCount: 0, itemPrice, shippingPrice: null, totalPrice: itemPrice, currency, priceVerified: itemPrice !== null, availability: page.price != null ? "Product listed · check local stock" : "Check local stock", condition: "New", attributes: attributesFor(query, `${snippet} ${title}`, "New", merchant, page), attributeLabels: attributeLabelsFor(query, `${snippet} ${title}`, page), destinationUrl: link, linkLabel: "View product" }; }

async function enrichOffer(offer, query) {
  if (!offer?.destinationUrl) return offer;
  const host = new URL(offer.destinationUrl).hostname;
  if (excludedHosts.test(host) || /(?:google|serpapi)\./i.test(host)) return offer;
  const page = await enrichProductPage(offer.destinationUrl);
  if (page.isCatalog || (page.title && !isRelevantProduct(page.title, query))) return offer;
  const itemPrice = offer.itemPrice ?? page.price ?? null, shippingPrice = offer.shippingPrice;
  return { ...offer, title: page.title && isRelevantProduct(page.title, query) ? page.title : offer.title, imageUrl: offer.imageUrl || page.imageUrl || "", itemPrice, ...costBreakdown({ itemPrice, shippingPrice, importTaxPrice: offer.importTaxPrice, taxPrice: offer.taxPrice, providerTotal: offer.totalPrice, crossBorder: offer.importTaxUnknown }), currency: offer.itemPrice === null && page.price !== null ? page.currency : offer.currency, priceVerified: itemPrice !== null, attributeLabels: { ...offer.attributeLabels, ...attributeLabelsFor(query, `${offer.title} ${page.specificationText ?? ""}`, page) }, attributes: { ...offer.attributes, ...attributesFor(query, `${offer.title} ${offer.subtitle} ${page.title ?? ""}`, offer.condition, offer.merchant, page) } };
}

function mergeLocalProducts(mapOffers, productOffers) {
  const unusedMaps = new Set(mapOffers);
  const enriched = productOffers.map((product) => {
    const productHost = safeHttpUrl(product.destinationUrl) ? new URL(product.destinationUrl).hostname.replace(/^www\./, "") : "";
    const match = mapOffers.find((store) => {
      if (!unusedMaps.has(store)) return false;
      const storeHost = safeHttpUrl(store.destinationUrl) ? new URL(store.destinationUrl).hostname.replace(/^www\./, "") : "";
      const left = shortRetailerName(store.merchant).toLowerCase(), right = shortRetailerName(product.merchant).toLowerCase();
      return (productHost && storeHost && productHost === storeHost) || (left.length > 2 && right.length > 2 && (left.includes(right) || right.includes(left)));
    });
    if (!match) return product;
    unusedMaps.delete(match);
    return { ...product, rating: match.rating || product.rating, reviewCount: match.reviewCount || product.reviewCount, distanceMiles: match.distanceMiles, subtitle: product.subtitle || match.subtitle };
  });
  const supplemental = [...unusedMaps].sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity)).slice(0, enriched.length ? 2 : 4);
  return [...enriched, ...supplemental];
}

function nearbyProductOffers(maps, offers) {
  return offers.filter(offer => offer.category === "order" && maps.some(store => {
    try { return new URL(store.destinationUrl).hostname.replace(/^www\./, "") === new URL(offer.destinationUrl).hostname.replace(/^www\./, ""); } catch { return false; }
  })).map(offer => ({ ...offer, id: `${offer.id}-pickup`, category: "local", totalPrice: offer.itemPrice, shippingPrice: null, importTaxPrice: null, taxPrice: null, otherFeesPrice: 0, importTaxUnknown: false, totalEstimated: false, availability: "Product listed · check branch stock" }));
}

function isCategoryPage(title, link) {
  return /\/cat(?:\/|\b)|models\.aspx|product-category|[?&](?:act=cat|catid=)/i.test(link)
    || /^(?:מסכי(?:ם|\s)|מסכים|מגוון|כל המוצרים)|מסכים מומלצים|^\s*(?:all products|shop all|browse)/i.test(String(title));
}

export function buildFacets(offers, query) {
  const specificIds = new Set((productRules.find((group) => group.match.test(query))?.rules ?? []).map(({ id }) => id));
  const discovered = new Map(offers.flatMap(offer => Object.entries(offer.attributeLabels ?? {})));
  const definitions = [["condition", "Condition"], ...rulesFor(query).map(({ id, label }) => [id, id === "brand" ? "Manufacturer" : label]), ...discovered, ["retailer", "Retailer"]];
  return definitions.filter(([id], index) => definitions.findIndex(([other]) => other === id) === index).map(([id, label]) => {
    const counts = new Map();
    let covered = 0;
    for (const offer of offers) { const values = [...new Set([offer.attributes[id] ?? []].flat())]; if (values.length) { covered++; for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); } }
    const specific = specificIds.has(id);
    const minimum = Math.max(2, Math.ceil(offers.length * (specific ? .05 : .2)));
    if (!counts.size || (!discovered.has(id) && (counts.size === 1 ? !specific : covered < minimum))) return null;
    return { id, label: discovered.get(id) ?? label, options: [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
  }).filter(Boolean);
}
function makeResult(query, offers) { const seen = new Set(), order = { local: 0, order: 1, secondHand: 2 }, clean = offers.filter((offer) => offer?.title && offer.destinationUrl && !seen.has(`${offer.category}|${offer.destinationUrl}`) && seen.add(`${offer.category}|${offer.destinationUrl}`)).sort((a, b) => order[a.category] - order[b.category]); return { query, resultCount: clean.length, offers: clean, facets: buildFacets(clean, query), source: "live" }; }
async function shoppingSearch(query, location, key) {
  const code = countryCode(location), params = new URLSearchParams({ engine: "google_shopping", q: localQuery(query, code), api_key: key, hl: code === "IL" ? "he" : "en", num: "40" });
  if (code) params.set("gl", code.toLowerCase());
  if (location && location !== "Current location") params.set("location", providerLocation(location));
  let data;
  try { data = await fetchJson(`https://serpapi.com/search.json?${params}`, {}, 14000); }
  catch (error) {
    if (!/unsupported.*location/i.test(error.message) || !params.has("location")) throw error;
    params.delete("location");
    data = await fetchJson(`https://serpapi.com/search.json?${params}`, {}, 14000);
  }
  const items = [...(data.shopping_results ?? []), ...(data.inline_shopping_results ?? [])].filter(item => isRelevantProduct(item.title, query));
  // Resolve a bounded set of product groups concurrently; each can contain several retailers.
  const direct = items.filter(item => item.link && !/google\./i.test(new URL(safeHttpUrl(item.link) || "https://google.com").hostname));
  const grouped = items.filter(item => item.immersive_product_page_token).slice(0, 4);
  const resolved = await Promise.allSettled(grouped.map(async (item) => {
    const params = new URLSearchParams({ engine: "google_immersive_product", page_token: item.immersive_product_page_token, api_key: key });
    const detail = (await fetchJson(`https://serpapi.com/search.json?${params}`, {}, 10000)).product_results ?? {};
    return (detail.stores ?? []).filter(store => !store.monthly_payment_duration && !store.installments_description).map((store, index) => ({ ...store, product_id: `${item.product_id}-${index}`, title: store.title || detail.title || item.title, source: store.name, source_icon: store.logo, thumbnail: item.thumbnail || detail.thumbnails?.[0], extensions: (store.details_and_offers ?? []).filter(text => !/משלוח|shipping|delivery/i.test(text)), specificationText: detail.about_the_product?.description, specifications: specificationPairs(detail.about_the_product?.features), brand: detail.brand }));
  }));
  if (grouped.length && resolved.every(result => result.status === "rejected") && !direct.length) throw new Error("Product links unavailable");
  const rows = [...direct, ...resolved.flatMap(result => result.status === "fulfilled" ? result.value : [])];
  // Older responses already provide merchant URLs in product_link.
  rows.push(...items.filter(item => !item.link && !item.immersive_product_page_token && item.product_link && !/google\./i.test(new URL(safeHttpUrl(item.product_link) || "https://google.com").hostname)));
  const offers = rows.map((item, index) => {
    const offer = shoppingOffer(item, index, query);
    if (!offer) return null;
    const shippingPrice = number(item.shipping_extracted) ?? (/free|חינם/i.test(item.shipping ?? "") ? 0 : offer.shippingPrice);
    return { ...offer, ...costBreakdown({ itemPrice: offer.itemPrice, shippingPrice, importTaxPrice: number(item.import_charges_extracted ?? item.extracted_import_charges), taxPrice: number(item.extracted_estimated_tax), providerTotal: number(item.extracted_total) }), attributeLabels: attributeLabelsFor(query, `${item.title} ${item.specificationText ?? ""}`, item), attributes: attributesFor(query, `${item.title} ${(item.extensions ?? []).join(" ")}`, offer.condition, offer.merchant, item) };
  }).filter(Boolean);
  return Promise.all(offers.map((offer, index) => index < 16 ? enrichOffer(offer, query) : offer));
}
async function mapsSearch(query, location, key, coordinates) {
  const origin = validCoordinates(coordinates);
  if (!origin && (!location || location === "Current location")) return [];
  const storeType = storeRules.find(([match]) => match.test(query))?.[1][0];
  const target = storeType ? `${storeType} stores` : `where to buy ${query}`;
  const place = location && location !== "Current location" ? providerLocation(location) : "";
  const params = new URLSearchParams({ engine: "google_maps", type: "search", q: place ? `${target} near ${place}` : `${target} near me`, api_key: key, hl: "en" });
  if (origin) params.set("ll", `@${origin.lat},${origin.lon},14z`);
  if (!place && origin) params.set("nearby", "true");
  const data = await fetchJson(`https://serpapi.com/search.json?${params}`, {}, 14000);
  return (data.local_results ?? []).map((place, index) => ({ place, index, score: relevance(place, query, origin) })).filter(({ score }) => Number.isFinite(score) && score >= 2).sort((a, b) => b.score - a.score).slice(0, 10).map(({ place, index }) => mapOffer(place, index, query, origin));
}
async function localProductSearch(query, location, key) { if (!location || location === "Current location") return []; const code = countryCode(location), tld = code ? countryTlds.get(code) : undefined, localTerms = code === "IL" ? `מחיר site:${tld}` : tld ? `price site:${tld}` : `price near ${location}`, params = new URLSearchParams({ engine: "google", q: `${localQuery(query, code)} ${localTerms} -inurl:cat -inurl:models -inurl:category`, api_key: key, hl: code === "IL" ? "he" : "en", num: "20" }); if (code) params.set("gl", code.toLowerCase()); const data = await fetchJson(`https://serpapi.com/search.json?${params}`, {}, 11000); const candidates = (data.organic_results ?? []).filter((item) => isRelevantProduct(item.title, query)).slice(0, 10); return (await Promise.all(candidates.map((item, index) => localProduct(item, index, query, location)))).filter(Boolean); }
async function runScope(scope, query, location, key, coordinates, credentials) { const jobs = scope === "online" ? [shoppingSearch(query, location, key), ebaySearch(query, location, credentials)] : scope === "local" ? [mapsSearch(query, location, key, coordinates)] : scope === "local-products" ? [localProductSearch(query, location, key)] : [shoppingSearch(query, location, key), mapsSearch(query, location, key, coordinates), localProductSearch(query, location, key), ebaySearch(query, location, credentials)]; const settled = await Promise.allSettled(jobs); if (settled.every(({ status }) => status === "rejected")) throw settled[0].reason; let offers = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []); if (scope === "all") { const online = settled[0]?.status === "fulfilled" ? settled[0].value : [], maps = settled[1]?.status === "fulfilled" ? settled[1].value : [], products = settled[2]?.status === "fulfilled" ? settled[2].value : [], usedOffers = settled[3]?.status === "fulfilled" ? settled[3].value : []; offers = [...mergeLocalProducts(maps, [...products, ...nearbyProductOffers(maps, online)]), ...online, ...usedOffers]; } const result = makeResult(query, await localizeOffers(offers, location));
  const labels = scope === "online" ? ["Online stores", "Second-hand listings"] : scope === "local" ? ["Nearby stores"] : scope === "local-products" ? ["Local product pages"] : ["Online stores", "Nearby stores", "Local product pages", "Second-hand listings"];
  result.warnings = settled.flatMap((entry, index) => entry.status === "rejected" ? [`${labels[index]} could not be searched. Please try again.`] : []);
  if ((!location || location === "Current location") && !coordinates && scope !== "online") result.warnings.push("Choose a location to include nearby stores.");
  return result; }
export async function searchCatalog(query, location, apiKey, coordinates, credentials, scope = "all") { if (!apiKey) throw new Error("SERPAPI_API_KEY is not configured"); const safeScope = ["all", "online", "local", "local-products"].includes(scope) ? scope : "all", point = validCoordinates(coordinates), cacheKey = `${safeScope}|${query.trim().toLowerCase()}|${String(location || "").trim().toLowerCase()}|${point ? `${point.lat.toFixed(4)},${point.lon.toFixed(4)}` : ""}`; const cached = cache.get(cacheKey); if (cached && Date.now() - cached.at < CACHE_MS) return cached.value; if (inFlight.has(cacheKey)) return inFlight.get(cacheKey); const request = runScope(safeScope, query.trim(), location, apiKey, point, credentials).then((value) => { if (!value.warnings?.length) cache.set(cacheKey, { at: Date.now(), value }); return value; }).finally(() => inFlight.delete(cacheKey)); inFlight.set(cacheKey, request); return request; }
