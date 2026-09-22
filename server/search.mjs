import { enrichProductPage, isSearchResultsUrl, productImageUrl } from "./product-page.mjs";
import { localizeOffers } from "./currency.mjs";
import { extractNamedSpecifications, monitorAttributes, proseAttributes, specificationPairs, structuredAttributes } from "./specifications.mjs";
import { amountInCurrency, costBreakdown } from "./costs.mjs";
import { englishLabel, normalizeOfferFacets, translateTerms } from "./facet-language.mjs";
import { fetchJson, mapConcurrent, searchProvider } from "./providers.mjs";
import { productWords, contradictsQuery, sameProductIdentity } from "./product-identity.mjs";
import { budgetFetch, deadlineError, searchContext, withSearchBudget } from "./search-budget.mjs";
import { catalogProductLinks } from "./catalog-products.mjs";
import { discoverRetailProducts } from "./retail-discovery.mjs";
import { discoverOctoparseProducts } from "./octoparse-discovery.mjs";
const cache = new Map(), inFlight = new Map(), osmStoreCache = new Map(), photonStoreCache = new Map(), geocodeCache = new Map(), geocodePending = new Map(), mapsQuotaBlockedUntil = new Map();
const CACHE_MS = 15 * 60 * 1000;
let ebayToken = null;

const colors = ["Black", "White", "Blue", "Red", "Green", "Silver", "Gold", "Gray", "Pink", "Brown", "Natural wood"];
const materials = ["Solid wood", "Engineered wood", "Wood", "Glass", "Marble", "Stone", "Ceramic", "Metal", "Plastic", "Leather", "Steel", "Aluminum", "Cotton"];
const features = ["Wireless", "Wired", "Bluetooth", "Wi-Fi", "Waterproof", "Water resistant", "Rechargeable", "Smart", "Portable", "Noise cancelling", "Foldable", "Adjustable", "Energy efficient", "Dishwasher safe", "Machine washable", "Silent", "Fast charging", "Remote control", "Touchscreen"];

function number(value) { if (typeof value === "number" && Number.isFinite(value)) return value; const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function includesPhrase(text, value) { return new RegExp(`(?:^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]")}(?:$|[^a-z0-9])`, "i").test(text); }
function inferValue(text, values) { return values.find((value) => includesPhrase(text, value)); }
function inferNumberBucket(text, pattern, buckets) { const value = number(text.match(pattern)?.[1]); return value === null ? undefined : buckets.find(([max]) => value <= max)?.[1]; }
function inferTableSize(text) { const seats = text.match(/(?:seats?|for|with)\s*(\d+)|(?:^|\D)(\d+)\s*(?:person|people|seater|chairs?)/i); const count = number(seats?.[1] ?? seats?.[2]); if (count !== null) return count <= 2 ? "2 seats" : count <= 4 ? "4 seats" : count <= 6 ? "6 seats" : "8+ seats"; return inferNumberBucket(text, /(?:^|\D)(\d{2,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|")/i, [[47, "Compact (under 48 in)"], [71, "Standard (48–71 in)"], [Infinity, "Large (72+ in)"]]); }
function inferChairs(text) { return /table only|without chairs|chairs not included/i.test(text) ? "Table only" : /(?:with|includes?)\s+(?:\d+\s+)?chairs?|table\s*(?:&|and)\s*(?:\d+\s+)?chairs?/i.test(text) ? "Includes chairs" : undefined; }
function inferExtendable(text) { return /non[- ]extendable|not extendable|fixed(?:[- ]length| top)? table|fixed dining table/i.test(text) ? "Fixed" : /extendable|extending|extension|expandable|drop[- ]leaf|butterfly[- ]leaf/i.test(text) ? "Extendable" : undefined; }
function inferScreen(text) { const match = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|"|''|אינץ)/i) || text.match(/"(\d{1,3}(?:\.\d+)?)\b/); return match ? `${match[1]} in` : undefined; }
function inferStorage(text, qualifier = "") { const pattern = qualifier ? new RegExp(`\\b(\\d+)\\s*(GB|TB)\\s+${qualifier}\\b`, "i") : /\b(\d+)\s*(GB|TB)\b/i; const match = text.match(pattern); return match ? `${match[1]} ${match[2].toUpperCase()}` : undefined; }
function capacity(value, unit) { return `${Number(value)} ${String(unit).toUpperCase()}`; }
function inferMemory(text) {
  const patterns = [
    /\b(?:RAM|system memory|memory)\s*[:=-]?\s*(\d+)\s*(GB|TB)\b/i,
    /\b(\d+)\s*(GB|TB)\s*(?:of\s+)?(?:RAM|system memory|memory)\b/i,
    /\b(\d+)\s*(GB|TB)\s*(?:DDR[3-5]?|LPDDR[3-5X]*)\b/i,
    /\b(?:DDR[3-5]?|LPDDR[3-5X]*)\s*(\d+)\s*(GB|TB)\b/i,
    /(?:זיכרון|זכרון|ראם)\s*[:=-]?\s*(\d+)\s*(GB|TB)\b/i,
    /\b(\d+)\s*(GB|TB)\s*(?:זיכרון|זכרון|ראם)\b/i,
    /\b(\d+)\s*(GB|TB)\s*[+/|]\s*\d+\s*(?:GB|TB)\b/i,
  ];
  for (const pattern of patterns) { const match = text.match(pattern); if (match && match[2].toUpperCase() === "GB" && Number(match[1]) <= 512) return capacity(match[1], match[2]); }
  const candidates = [...text.matchAll(/\b(\d+)\s*(GB|TB)\b/gi)].map(match => ({ value: Number(match[1]), unit: match[2].toUpperCase() }));
  if (candidates.length >= 2) { const memory = candidates.find(({ value, unit }) => unit === "GB" && value <= 128); if (memory) return capacity(memory.value, memory.unit); }
}
function inferLaptopStorage(text) {
  const patterns = [
    /\b(?:storage|SSD|HDD|NVMe|eMMC)\s*[:=-]?\s*(\d+)\s*(GB|TB)\b/i,
    /\b(\d+)\s*(GB|TB)\s*(?:SSD|HDD|NVMe|eMMC|storage)\b/i,
    /(?:אחסון|כונן)\s*[:=-]?\s*(\d+)\s*(GB|TB)\b/i,
    /\b\d+\s*(?:GB|TB)\s*[+/|]\s*(\d+)\s*(GB|TB)\b/i,
  ];
  for (const pattern of patterns) { const match = text.match(pattern); if (match) return capacity(match[1], match[2]); }
  const candidates = [...text.matchAll(/\b(\d+)\s*(GB|TB)\b/gi)].map(match => ({ value: Number(match[1]), unit: match[2].toUpperCase() }));
  const plausible = candidates.filter(({ value, unit }) => unit === "TB" || value >= 128);
  return plausible.length ? capacity(plausible.at(-1).value, plausible.at(-1).unit) : undefined;
}
function inferShoeSize(text) { const match = text.match(/(?:size|US)\s*(\d{1,2}(?:\.5)?)/i); return match ? `US ${match[1]}` : undefined; }
function inferWattage(text) { const match = text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i); if (!match) return undefined; const value = number(match[1]); return value === null ? undefined : value < 500 ? "Under 500 W" : value < 700 ? "500–699 W" : value < 900 ? "700–899 W" : value < 1200 ? "900–1199 W" : "1200 W+"; }
function inferResolution(text) {
  return /8k|7680\s*[x×]\s*4320/i.test(text) ? "8K" : /4k|uhd|3840\s*[x×]\s*2160/i.test(text) ? "4K" : /1440p|(?:w?qhd)|2560\s*[x×]\s*1440|3440\s*[x×]\s*1440/i.test(text) ? "1440p" : /1080p|fhd|full hd|1920\s*[x×]\s*1080/i.test(text) ? "1080p" : undefined;
}
function inferPanel(text) { return /qd[- ]?oled/i.test(text) ? "QD-OLED" : /w[- ]?oled/i.test(text) ? "WOLED" : /oled/i.test(text) ? "OLED" : /mini[- ]?led/i.test(text) ? "Mini-LED" : inferValue(text, ["QLED", "IPS", "VA", "TN", "LED", "LCD"]); }
function inferUnit(text, pattern, unit) { const value = text.match(pattern)?.[1]; return value ? `${Number(value)} ${unit}` : undefined; }
function inferBoolean(text, yes, no, yesLabel, noLabel) { return yes.test(text) ? yesLabel : no.test(text) ? noLabel : undefined; }

const productRules = [
  { match: /\bdock(?:ing station)?s?\b/i, rules: [{ id: "connectivity", label: "Connectivity", values: ["USB-C", "Thunderbolt", "USB 3.0", "USB 2.0"] }] },
  { match: /dining\s+(?:table|set)/i, rules: [{ id: "tableSize", label: "Size / seats", infer: inferTableSize }, { id: "material", label: "Material", values: materials }, { id: "shape", label: "Shape", values: ["Rectangular", "Round", "Oval", "Square"] }, { id: "chairsIncluded", label: "Chairs included", infer: inferChairs }, { id: "extendable", label: "Extendable", infer: inferExtendable }] },
  { match: /clock/i, rules: [{ id: "clockType", label: "Clock type", values: ["Wall clock", "Alarm clock", "Desk clock", "Smart clock", "Mantel clock"] }, { id: "movement", label: "Movement", values: ["Quartz", "Digital", "Mechanical", "Atomic"] }] },
  { match: /coffee\s+(?:maker|machine)|espresso|french press/i, rules: [{ id: "type", label: "Coffee maker type", values: ["Drip", "Espresso", "Pod", "Single serve", "Cold brew", "French press"] }] },
  { match: /shoes?|sneakers?|boots?/i, rules: [{ id: "activity", label: "Activity", values: ["Running", "Trail", "Walking", "Hiking", "Basketball", "Training"] }, { id: "shoeSize", label: "Size", infer: inferShoeSize }] },
  { match: /(?:laptop|notebook)\s+(?:stand|riser|holder|tray)|(?:stand|riser|holder|tray)\s+(?:for\s+)?(?:laptop|notebook)/i, rules: [{ id: "material", label: "Material", values: materials }, { id: "features", label: "Features", values: features }] },
  { match: /laptop|notebook|chromebook/i, rules: [{ id: "platform", label: "Platform", values: ["Windows", "MacBook", "Chromebook", "Gaming"] }, { id: "screenSize", label: "Screen size", infer: inferScreen }, { id: "memory", label: "Memory / RAM", infer: inferMemory }, { id: "storage", label: "Storage", infer: inferLaptopStorage }] },
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
const excludedHosts = /(?:amazon|ebay|etsy|facebook|pinterest|aliexpress|temu|wikipedia)\./i;
const comparisonHosts = /(^|\.)(?:zap\.co\.il|wisebuy\.co\.il|pricez\.co\.il|pricerunner\.[a-z.]+|pricespy\.[a-z.]+|idealo\.[a-z.]+|camelcamelcamel\.com|keepa\.com|pcpartpicker\.com)$/i;
const countries = new Map([["israel", "IL"], ["united states", "US"], ["usa", "US"], ["canada", "CA"], ["united kingdom", "GB"], ["uk", "GB"], ["germany", "DE"], ["france", "FR"], ["italy", "IT"], ["spain", "ES"], ["australia", "AU"]]);
const countryTlds = new Map([["IL", ".il"], ["GB", ".uk"], ["CA", ".ca"], ["DE", ".de"], ["FR", ".fr"], ["IT", ".it"], ["ES", ".es"], ["AU", ".au"]]);

export function safeHttpUrl(value, fallback = "") { try { const decoded = String(value ?? "").replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16))).replace(/\\\//g, "/"); const parsed = new URL(decoded); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : fallback; } catch { return fallback; } }
function searchTokens(value) { const stop = new Set(["a", "an", "and", "at", "best", "buy", "cheap", "deals", "for", "in", "near", "of", "on", "price", "sale", "the", "to", "with"]); return [...new Set(String(value).toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, " ").split(/\s+/).filter((token) => token.length > 1 && !stop.has(token)).map((token) => token.replace(/(?:ies|es|s)$/i, (ending) => ending === "ies" ? "y" : "")))]; }
const translatedCategories = [
  [/\bdock(?:ing station)?s?\b/i, /תחנ(?:ת|ות) עגינה/, "תחנת עגינה"],
  [/camping tent|tent/i, /אוהל/, "אוהל"],
  [/monitor|television|\btv\b/i, /מס[ךכ]/, "מסך"], [/headphones?|earbuds?/i, /אוזני[וה]ת/, "אוזניות"],
  [/dining\s+(?:table|set)/i, /שולח[ןנות]|פינת אוכל/, "שולחן אוכל"], [/clock/i, /שעו[ןנים]/, "שעון"],
  [/\b(?:bedside|desk|table)\s+lamps?\b/i, /מנור(?:ות|ת|ה)\s+(?:שולחן|לילה|ליד המיטה)/, "מנורת שולחן"],
  [/\b(?:floor|standing)\s+lamps?\b/i, /מנור(?:ות|ת|ה)\s+(?:רצפה|עמידה)/, "מנורת רצפה"],
  [/\bwall\s+lamps?\b/i, /מנור(?:ות|ת|ה)\s+קיר/, "מנורת קיר"],
  [/\blamps?\b/i, /מנורות|מנורה|מנורת/, "מנורה"],
  [/power supply|\bpsu\b/i, /ספק.*כ[ו]?ח/, "ספק כוח"], [/laptop|notebook/i, /מחשב.*נייד/, "מחשב נייד"],
  [/vacuum/i, /שואב/, "שואב אבק"], [/printer/i, /מדפסת/, "מדפסת"], [/phone|smartphone/i, /טלפון/, "טלפון"],
  [/chair/i, /כיסא|כסא/, "כיסא"], [/desk/i, /שולחן/, "שולחן"], [/camera/i, /מצלמה/, "מצלמה"],
  [/charger/i, /מטען/, "מטען"],
  [/\bmouse\b|\bmice\b/i, /עכבר/, "עכבר"],
];
export function isRelevantProduct(title, query) {
  if (contradictsQuery(title, query)) return false;
  title = productWords(title); query = productWords(query);
  if (/\bclock\b/i.test(query) && /\b(?:watch|watches|smartwatch|wristwatch)\b|שעו(?:ן|ני)\s+(?:יד|חכ)/i.test(title)) return false;
  if (/laptop|notebook|chromebook/i.test(query) && /motherboard|mainboard|replacement (?:battery|screen|keyboard)|(?:battery|charger|screen|keyboard)\s+for\b/i.test(title)) return false;
  if (/camping tent/i.test(query) && /tent (?:carpet|rug|spring buckle|rope tensioner)|camping (?:complex|site)|(?:פנס|עששית|תאורה|אירוח|מתחם קמפינג).*אוהל/i.test(title)) return false;
  if (/camping tent/i.test(query) && /tent (?:stakes|poles|stove|footprint)|(?:stove|heater) (?:for|with).{0,15}tent|play tent|אוהל (?:משחק|ילדים)/i.test(title)) return false;
  if (/monitor|television|\btv\b/i.test(query)) {
    if (/^(?:stand|base|bracket|mount|arm|power supply)\b|\bmonitor\s+(?:stand|base|bracket|mount|arm)\b|\b(?:stand|base|bracket|mount|arm)\s+(?:for|only)\b|external power supply/i.test(title)) return false;
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
  return matched.length === wanted.length;
}
function localQuery(query, code) {
  if (code !== "IL") return query;
  if (/\b(?:rechargeable\s+)?batter(?:y|ies)\b/i.test(query)) return query.replace(/rechargeable\s+batter(?:y|ies)/ig, "סוללות נטענות").replace(/batter(?:y|ies)/ig, "סוללות");
  if (/(?:laptop|notebook)\s+(?:stand|riser|holder|tray)|(?:stand|riser|holder|tray)\s+(?:for\s+)?(?:laptop|notebook)/i.test(query)) return query;
  const translated = translatedCategories.find(([match]) => match.test(query));
  if (!translated) return query; // Do not translate only adjectives and leave an unknown product noun behind.
  const localized = query.replace(translated[0], translated[2]).replace(/1440p/ig, "2560x1440");
  const modifiers = { digital: "דיגיטלי", alarm: "מעורר", wall: "קיר", wireless: "אלחוטי", external: "חיצוני", gaming: "גיימינג" };
  return localized.replace(/\b(digital|alarm|wall|wireless|external|gaming)\b/gi, word => modifiers[word.toLowerCase()]);
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
  { id: "capacity", label: "Capacity", infer: (text) => text.match(/\b(\d+(?:\.\d+)?\s*(?:ml|l|liters?|oz|cups?|quarts?|people|person))\b/i)?.[1] },
  { id: "power", label: "Power", infer: (text) => text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i)?.[1] ? `${text.match(/\b(\d{2,5})\s*w(?:att)?s?\b/i)[1]} W` : undefined },
  { id: "packSize", label: "Pack size", infer: (text) => { const multiple = text.match(/\b(\d+)\s*pack\s*[x×]\s*(\d+)\b/i), count = text.match(/\b(?:pack\s+of\s+|מארז\s*(?:של\s*)?)(\d+)\b/i)?.[1] ?? text.match(/\b(\d+)\s*(?:pack|count|ct|pieces?)\b/i)?.[1]; return multiple ? `${Number(multiple[1]) * Number(multiple[2])} pack` : count ? `${count} pack` : undefined; } },
  { id: "storage", label: "Storage", infer: inferStorage },
  { id: "connectivity", label: "Connectivity", values: ["Bluetooth", "Wi-Fi", "Wired", "USB-C", "Lightning", "HDMI"] },
  { id: "weight", label: "Weight", infer: (text) => text.match(/\b(\d+(?:\.\d+)?\s*(?:kg|g|lb|lbs|oz))\b/i)?.[1] },
];
function rulesFor(query) {
  const specific = productRules.find((group) => group.match.test(query))?.rules ?? [];
  const ids = new Set(specific.map(({ id }) => id));
  return [...specific, ...genericRules.filter(({ id }) => !ids.has(id))];
}
function attributesFor(query, text, condition, merchant, meta = {}) {
  text = translateTerms(`${text} ${meta.specificationText ?? ""}`);
  const attributes = { condition, retailer: shortRetailerName(merchant) };
  for (const rule of rulesFor(query)) {
    if (attributes[rule.id]) continue;
    const value = rule.infer ? rule.infer(text, meta) : rule.values.filter(value => includesPhrase(text, value)).filter((value, _, matches) => !matches.some(other => other !== value && includesPhrase(other, value)));
    if (value && (!Array.isArray(value) || value.length)) attributes[rule.id] = Array.isArray(value) && value.length === 1 ? value[0] : value;
  }
  const result = { ...attributes, ...proseAttributes(translateTerms(meta.specificationText ?? "") + " " + text).attributes, ...monitorAttributes(query, text).attributes, ...structuredAttributes(meta.specifications).attributes };
  if (result.brand) result.brand = Array.isArray(result.brand) ? result.brand.map(value => value.toUpperCase()) : result.brand.toUpperCase();
  return result;
}
function fillMissingAttributes(current, additions) {
  const result = { ...current };
  for (const [id, value] of Object.entries(additions ?? {})) if (!valuesForFacet({ attributes: result }, id).length) result[id] = value;
  return result;
}
function attributeLabelsFor(query, text, meta = {}) { text = translateTerms(text + " " + (meta.specificationText ?? "")); return { ...proseAttributes(text).labels, ...monitorAttributes(query, text).labels, ...structuredAttributes(meta.specifications).labels }; }

export function matchingShoppingEvidence(item, offer) {
  const normalized = value => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const shop = normalized(shortRetailerName(item.source));
  const host = new URL(offer.destinationUrl).hostname.replace(/^www\./, "").split(".")[0];
  if (!shop || ![normalized(offer.merchant), normalized(host)].includes(shop)) return offer;
  const models = value => (String(value).match(/\b[a-z\d][a-z\d-]{4,}\b/gi) || []).filter(token => /[a-z]/i.test(token) && /\d/.test(token)).map(normalized);
  const same = normalized(item.title) === normalized(offer.title) || models(item.title).some(model => models(offer.title).includes(model));
  if (!same) return offer;
  const image = productImageUrl(item.thumbnail || item.image);
  const price = offer.itemPrice ?? number(item.extracted_price ?? item.price);
  return { ...offer, imageUrl: offer.imageUrl || image, imageUrls: [...new Set([...(offer.imageUrls || []), image].filter(Boolean))], itemPrice: price, totalPrice: price, currency: offer.itemPrice == null ? explicitCurrency(item.price || "") || offer.currency : offer.currency, priceVerified: offer.priceVerified || price !== null };
}
function used(item) { return /used|pre.?owned|refurb|renewed|open box|vintage|second.?hand|mercari|poshmark|offerup|back market/i.test(`${item.title ?? ""} ${item.condition ?? ""} ${item.badge ?? ""} ${item.source ?? ""}`); }
function local(item) { return /(?:store|curbside|local)\s+pickup|pick\s*up\s+(?:today|in store)|in-store pickup/i.test(`${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`); }
function validCoordinates(value) { const lat = Number(value?.lat), lon = Number(value?.lon); return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; }
function distanceMiles(origin, point) { const destination = validCoordinates(point); if (!origin || !destination) return undefined; const rad = (value) => value * Math.PI / 180, dLat = rad(destination.lat - origin.lat), dLon = rad(destination.lon - origin.lon); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origin.lat)) * Math.cos(rad(destination.lat)) * Math.sin(dLon / 2) ** 2; return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function relevance(place, _query, origin) { const distance = distanceMiles(origin, place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null); if (distance !== undefined && distance > 50) return -Infinity; return 2 + (place.website ? 1 : 0) + (distance === undefined ? 0 : Math.max(0, 2 - distance / 10)); }
function shippingFor(item, itemPrice) { const text = `${item.delivery ?? ""} ${(item.extensions ?? []).join(" ")}`; if (/free (delivery|shipping)/i.test(text)) return { shippingPrice: 0, totalPrice: itemPrice, shippingEstimated: false }; const match = text.match(/(?:shipping|delivery)[^$]*\$([0-9]+(?:\.[0-9]{1,2})?)/i); const shippingPrice = match ? number(match[1]) : null; return { shippingPrice, totalPrice: itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : itemPrice, shippingEstimated: shippingPrice !== null }; }
function countryCode(location) { const text = String(location ?? "").toLowerCase(); for (const [name, code] of countries) if (text.includes(name)) return code; return null; }
function searchLocation(location, coordinates) {
  if (location && location !== "Current location") return location;
  const point = validCoordinates(coordinates);
  if (point && point.lat >= 29.3 && point.lat <= 33.4 && point.lon >= 34.2 && point.lon <= 35.9) return "Israel";
  return location;
}
function isLocalResult(url, item, location) { const code = countryCode(location); if (!code || code === "US") return true; const tld = countryTlds.get(code), text = `${item.title ?? ""} ${item.snippet ?? ""} ${item.price ?? ""} ${item.displayed_link ?? ""}`; if (tld && url.hostname.endsWith(tld)) return true; if (code === "IL") return /[\u0590-\u05ff]|₪|\bILS\b|\bIsrael\b/i.test(text); return String(location).toLowerCase().split(/[,\s]+/).filter((part) => part.length > 3).some((part) => text.toLowerCase().includes(part)); }

async function ebayAccess(credentials) { if (!credentials?.clientId || !credentials?.clientSecret) return null; if (ebayToken?.expiresAt > Date.now() + 60000) return ebayToken.value; const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64"); const data = await fetchJson("https://api.ebay.com/identity/v1/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }) }, 2500); ebayToken = { value: data.access_token, expiresAt: Date.now() + (number(data.expires_in) ?? 7200) * 1000 }; return data.access_token; }
const ebayCache = new Map();
async function ebaySearch(query, location, credentials) {
  const key = JSON.stringify([query, location, credentials?.clientId]);
  const cached = ebayCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = fetchEbayOffers(query, location, credentials).catch(error => { ebayCache.delete(key); throw error; });
  ebayCache.set(key, { value, expires: Date.now() + 900000 });
  if (ebayCache.size > 100) ebayCache.delete(ebayCache.keys().next().value);
  return value;
}
async function fetchEbayOffers(query, location, credentials) {
  const token = await ebayAccess(credentials);
  if (!token) return [];
  const country = countryCode(location), filters = [];
  if (country) filters.push(`deliveryCountry:${country}`);

  const headers = { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };
  if (country) headers["X-EBAY-C-ENDUSERCTX"] = `contextualLocation=country=${country}`;
  const groups = await Promise.all(["NEW", "USED"].map(async searchCondition => {
    const params = new URLSearchParams({ q: query, limit: "8", filter: [...filters, `conditions:{${searchCondition}}`].join(",") });
    const data = await fetchJson(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, { headers }, 3500);
    return (data.itemSummaries ?? []).map(item => ({ ...item, searchCondition }));
  }));
  const items = [...new Map(groups.flat().filter(item => isRelevantProduct(item.title, query)).map(item => [item.itemId, item])).values()];
  await mapConcurrent(items, 8, async item => {
    if (!item.itemId) return;
    try {
      const detail = await fetchJson(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(item.itemId)}`, { headers }, 2200);
      item.specifications = [...specificationPairs(detail.localizedAspects), ...extractNamedSpecifications(detail.description || "")];
      // Seller HTML also contains ads and compatible products. Only named specification
      // rows are evidence; mining all its prose assigns those other products' features.
      item.specificationText = detail.shortDescription || "";
      item.gtin = detail.gtin;
      item.mpn = detail.mpn;
      item.productBrand = detail.brand;
      item.shippingOptions = detail.shippingOptions ?? item.shippingOptions;
      item.importCharges = detail.importCharges ?? item.importCharges;
      if (detail.brand) item.specifications.push({ name: "Manufacturer", value: detail.brand });
    } catch { /* Basic offers remain available when detail enrichment fails. */ }
  });
  return items.map((item, index) => {
    const price = item.price, shipping = item.shippingOptions?.[0]?.shippingCost;
    const itemPrice = number(price?.convertedFromCurrency === "USD" ? price.convertedFromValue : price?.value);
    const shippingPrice = number(shipping?.convertedFromCurrency === "USD" ? shipping.convertedFromValue : shipping?.value);
    const totalPrice = itemPrice !== null && shippingPrice !== null ? itemPrice + shippingPrice : itemPrice;
    const condition = item.condition || (item.searchCondition === "NEW" ? "New" : "Used"), merchant = "eBay", category = String(item.conditionId) === "1000" || /^new(?:\b|$)/i.test(condition) ? "order" : "secondHand";
    return { id: `ebay-${item.itemId ?? index}`, gtin: item.gtin, mpn: item.mpn, productBrand: item.productBrand, category, merchant, merchantLogoUrl: "/ebay.svg", title: item.title || "Pre-owned eBay listing", subtitle: [condition, item.itemLocation?.country].filter(Boolean).join(" · "), imageUrl: safeHttpUrl(item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl), rating: number(item.seller?.feedbackPercentage) ? Math.min(5, number(item.seller.feedbackPercentage) / 20) : 0, reviewCount: number(item.seller?.feedbackScore) ?? 0, itemPrice, shippingPrice, totalPrice, currency: price?.convertedFromCurrency === "USD" ? "USD" : price?.currency || "USD", ...costBreakdown({ itemPrice, shippingPrice, importTaxPrice: amountInCurrency(item.shippingOptions?.[0]?.importCharges ?? item.importCharges, price?.convertedFromCurrency === "USD" ? "USD" : price?.currency || "USD"), crossBorder: !!country && !!item.itemLocation?.country && item.itemLocation.country !== country }), priceVerified: totalPrice !== null, availability: "Available on eBay", condition, attributes: attributesFor(query, item.title || "", condition, merchant, item), attributeLabels: attributeLabelsFor(query, item.title || "", item), destinationUrl: safeHttpUrl(item.itemWebUrl), linkLabel: "View product" };
  }).filter((offer) => offer.destinationUrl);
}
function shoppingOffer(item, index, query) { if (!isRelevantProduct(item.title, query) || !safeHttpUrl(item.link || item.product_link)) return null; const itemPrice = number(item.extracted_price ?? item.price), shipping = shippingFor(item, itemPrice), isUsed = used(item), isLocal = !isUsed && local(item), merchant = shortRetailerName(item.source || item.merchant || item.seller || "Retailer"), text = `${item.title ?? ""} ${(item.extensions ?? []).join(" ")}`, condition = isUsed ? (item.condition || (/refurb|renewed/i.test(text) ? "Refurbished" : "Used")) : "New", shippingPrice = isLocal ? null : shipping.shippingPrice; return { id: `serp-${item.product_id ?? item.position ?? index}`, category: isUsed ? "secondHand" : isLocal ? "local" : "order", merchant, merchantLogoUrl: safeHttpUrl(item.source_icon || item.favicon), title: item.title || "Product offer", subtitle: (item.extensions ?? []).slice(0, 3).join(" · ") || item.delivery || "See retailer for product details", imageUrl: productImageUrl(item.thumbnail || item.image), rating: number(item.rating) ?? 0, reviewCount: number(item.reviews) ?? 0, itemPrice, shippingPrice, totalPrice: itemPrice === null ? null : shippingPrice === null ? itemPrice : shipping.totalPrice, currency: /₪|NIS|ILS/i.test(`${item.price ?? ""} ${text}`) ? "ILS" : /€|EUR/i.test(`${item.price ?? ""} ${text}`) ? "EUR" : /£|GBP/i.test(`${item.price ?? ""} ${text}`) ? "GBP" : "USD", shippingEstimated: shipping.shippingEstimated, priceVerified: itemPrice !== null, availability: isLocal ? "Check local stock" : "Available online", arrival: isLocal ? undefined : item.delivery, condition, attributes: attributesFor(query, text, condition, merchant), destinationUrl: safeHttpUrl(item.link || item.product_link), linkLabel: "View product" }; }
function mapOffer(place, index, query, origin) { const merchant = place.title || place.name || "Local store", itemPrice = number(place.extracted_price ?? place.product_price), point = place.gps_coordinates ? { lat: place.gps_coordinates.latitude, lon: place.gps_coordinates.longitude } : null, placeId = place.place_id ?? place.data_id, mapsUrl = placeId ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}` : ""; return { id: `local-${placeId ?? index}`, category: "local", merchant, merchantLogoUrl: safeHttpUrl(place.favicon || place.icon), title: merchant, subtitle: [place.type, place.address].filter(Boolean).join(" · ") || "Nearby store", imageUrl: productImageUrl(place.thumbnail || place.image || place.photos?.[0]?.thumbnail || place.photos?.[0]?.image), rating: number(place.rating) ?? 0, reviewCount: number(place.reviews) ?? 0, itemPrice, shippingPrice: null, totalPrice: itemPrice, currency: "USD", priceVerified: itemPrice !== null, potentialStore: true, availability: "", distanceMiles: distanceMiles(origin, point), attributes: { retailer: shortRetailerName(merchant) }, destinationUrl: safeHttpUrl(place.website || place.links?.directions || place.google_maps_url || mapsUrl), linkLabel: "View store" }; }
async function resolveGoogleGoto(value) {
  const link = safeHttpUrl(value);
  if (!link) return "";
  const url = new URL(link);
  if (!/(^|\.)google\./i.test(url.hostname) || url.pathname !== "/goto") return link;
  try {
    const response = await budgetFetch(link, { redirect: "manual", signal: AbortSignal.timeout(1200), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36" } });
    const destination = safeHttpUrl(response.headers?.get?.("location"));
    if (!destination) console.info("merchant_redirect_failed", { status: response.status });
    try { await response.body?.cancel?.(); } catch { /* The redirect target is all that is needed. */ }
    if (!destination) return "";
    const target = new URL(destination);
    return /(^|\.)google\./i.test(target.hostname) ? "" : destination;
  } catch (error) { console.info("merchant_redirect_failed", { reason: error.name }); return ""; }
}
function explicitCurrency(text) { return /₪|\bNIS\b|\bILS\b/i.test(text) ? "ILS" : /€|\bEUR\b/i.test(text) ? "EUR" : /£|\bGBP\b/i.test(text) ? "GBP" : /\$|\bUSD\b/i.test(text) ? "USD" : null; }
function localPrice(text, extracted) { const direct = number(extracted); if (direct !== null) return { value: direct, currency: explicitCurrency(text) ?? "USD" }; const ils = text.match(/(?:₪|NIS|ILS)\s*([0-9][0-9,.]*)|([0-9][0-9,.]*)\s*(?:₪|NIS|ILS)/i); if (ils) return { value: number(ils[1] ?? ils[2]), currency: "ILS" }; const usd = text.match(/\$\s*([0-9][0-9,.]*)/); return usd ? { value: number(usd[1]), currency: "USD" } : { value: null, currency: "USD" }; }
async function indexedMerchantOffer(item, result, index, query) {
  const destinationUrl = await resolveGoogleGoto(result.link);
  if (!destinationUrl || isCategoryPage(result.title, destinationUrl)) return null;
  const host = new URL(destinationUrl).hostname;
  if (excludedHosts.test(host) || comparisonHosts.test(host) || new URL(destinationUrl).pathname === "/") return null;
  const compact = value => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const shop = compact(shortRetailerName(item.source));
  const sameMerchant = shop.length >= 3 && (shop === compact(result.source) || (/^[a-z\d]+$/.test(shop) && compact(host).includes(shop)));
  if (!sameMerchant || /out of stock|sold out|אזל.?במלאי|לא.?במלאי/i.test(`${result.title} ${result.snippet}`)) return null;
  const evidence = matchingShoppingEvidence(item, { title: result.title, merchant: item.source, destinationUrl, itemPrice: null, imageUrl: "", currency: "USD" });
  if (evidence.itemPrice === null || !evidence.imageUrl) return null;
  const offer = shoppingOffer({ ...item, link: destinationUrl }, index, query);
  if (!offer) return null;
  // Matching indexed model + merchant evidence survives a blocked page fetch.
  // Explicit deletion, category redirects and stock evidence still reject it.
  return enrichOffer({ ...offer, priceVerified: false, attributes: fillMissingAttributes(offer.attributes, attributesFor(query, `${item.title} ${result.title} ${result.snippet ?? ""}`, offer.condition, offer.merchant, item)) }, query);
}
async function localProduct(item, index, query, location) { const link = await resolveGoogleGoto(item.link); if (!link || isCategoryPage(item.title, link) || !isRelevantProduct(item.title, query)) return null; const url = new URL(link); if (comparisonHosts.test(url.hostname) || excludedHosts.test(url.hostname) || url.pathname === "/" || /\/cat(?:\/|\b)|models\.aspx|[?&]act=cat\b/i.test(link) || /zap\.co\.il$/i.test(url.hostname) || !isLocalResult(url, item, location)) return null; const snippet = `${item.title ?? ""} ${item.snippet ?? ""} ${item.price ?? ""} ${(item.rich_snippet?.top?.extensions ?? []).join(" ")}`, page = await enrichProductPage(link), title = page.title || item.title; if (page.unavailable || page.isCatalog || isCategoryPage(title, link) || !isRelevantProduct(title, query)) return null; const fallback = localPrice(snippet, item.extracted_price), itemPrice = page.price ?? fallback.value, currency = page.price != null ? page.currency : explicitCurrency(snippet) ?? fallback.currency, merchant = shortRetailerName(item.source || item.displayed_link?.split(" › ")[0] || url.hostname.replace(/^www\./, "").split(".")[0]); if (!page.isProduct) return null; return { id: `local-product-${index}-${url.hostname}`, category: "order", merchant, merchantLogoUrl: safeHttpUrl(item.favicon), title, subtitle: String(item.snippet ?? "").slice(0, 150) || (location && location !== "Current location" ? `Available near ${location}` : "Available online"), imageUrl: page.imageUrl || productImageUrl(item.thumbnail || item.image), imageUrls: page.imageUrls ?? [], gtin: page.gtin, mpn: page.mpn, productBrand: page.brand, rating: 0, reviewCount: 0, itemPrice, shippingPrice: null, totalPrice: itemPrice, currency, priceVerified: page.price != null, availability: page.availability || "", totalEstimated: true, condition: "New", attributes: attributesFor(query, `${snippet} ${title}`, "New", merchant, page), attributeLabels: attributeLabelsFor(query, `${snippet} ${title}`, page), destinationUrl: link, linkLabel: "View product" }; }

async function enrichOffer(offer, query, requireProductPage = false) {
  if (!offer?.destinationUrl) return offer;
  const host = new URL(offer.destinationUrl).hostname;
  if (comparisonHosts.test(host)) return null;
  if (excludedHosts.test(host) || /(?:google|serpapi)\./i.test(host)) return requireProductPage ? null : offer;
  const page = await enrichProductPage(offer.destinationUrl);
  if (page.unavailable || page.isCatalog || (page.title && !isRelevantProduct(page.title, query)) || (requireProductPage && !page.isProduct)) return null;
  const itemPrice = page.price ?? offer.itemPrice ?? null, shippingPrice = offer.shippingPrice;
  return { ...offer, availability: page.availability || "", title: page.title && isRelevantProduct(page.title, query) ? page.title : offer.title, imageUrl: page.imageUrl || offer.imageUrl || "", imageUrls: [...new Set([...(page.imageUrls ?? []), offer.imageUrl].filter(Boolean))], gtin: page.gtin || offer.gtin, mpn: page.mpn || offer.mpn, productBrand: page.brand || offer.productBrand, itemPrice, ...costBreakdown({ itemPrice, shippingPrice, importTaxPrice: offer.importTaxPrice, taxPrice: offer.taxPrice, providerTotal: offer.totalPrice, crossBorder: offer.importTaxUnknown }), currency: page.price != null ? page.currency : offer.currency, priceVerified: page.price != null, attributeLabels: { ...offer.attributeLabels, ...attributeLabelsFor(query, `${offer.title} ${page.specificationText ?? ""}`, page) }, attributes: fillMissingAttributes(offer.attributes, attributesFor(query, `${offer.title} ${offer.subtitle} ${page.title ?? ""}`, offer.condition, offer.merchant, page)) };
}

function storeMatchesProduct(store, product) {
  const site = merchantWebsite(store.destinationUrl), destination = merchantWebsite(product.destinationUrl);
  if (!destination) return false;
  if (site) {
    const merchantDomain = value => {
      const labels = new URL(value).hostname.toLowerCase().replace(/^www\./, "").split(".");
      return labels.slice(-(/^(?:co|com|org|net|ac|gov)\.(?:il|uk|au|nz)$/.test(labels.slice(-2).join(".")) ? 3 : 2)).join(".");
    };
    return merchantDomain(site) === merchantDomain(destination);
  }
  // Local packs often supply a business name and address without a website.
  // Match a complete merchant identity, never a substring such as PC / PC Store.
  const identity = value => shortRetailerName(value).replace(/\s+(?:online|אונליין)$/iu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const left = identity(store.merchant), right = identity(product.merchant);
  if (left.length >= 3 && left === right) return true;
  const domainName = new URL(destination).hostname.replace(/^www\./, "").split(".")[0];
  return left.length >= 3 && left === identity(domainName);
}

function mergeLocalProducts(mapOffers, productOffers) {
  const enriched = productOffers.map((product) => {
    const match = mapOffers.filter(store => storeMatchesProduct(store, product))
      .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))[0];
    if (!match) return product;
    return { ...product, rating: match.rating || product.rating, reviewCount: match.reviewCount || product.reviewCount, distanceMiles: match.distanceMiles, subtitle: product.potentialStore ? match.subtitle || product.subtitle : product.subtitle || match.subtitle, availability: product.potentialStore ? match.availability || product.availability : product.availability };
  });
  return enriched;
}

export function merchantWebsite(value) {
  const link = safeHttpUrl(value);
  if (!link) return "";
  const host = new URL(link).hostname.toLowerCase();
  return /(^|\.)(?:google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|maps\.apple\.com|openstreetmap\.org|mapcarta\.com|atly\.com|easy\.co\.il|infobel\.com|facebook\.com|instagram\.com|waze\.com|yelp\.com|g\.page)$/.test(host) ? "" : link;
}

function nearbyProductOffers(maps, offers) {
  return offers.filter(offer => offer.category === "order" && offer.itemPrice !== null && !!offer.imageUrl && maps.some(store => storeMatchesProduct(store, offer)))
    .map(offer => ({ ...offer, id: `${offer.id}-pickup`, category: "local", totalPrice: offer.itemPrice, shippingPrice: null, importTaxPrice: null, taxPrice: null, otherFeesPrice: 0, importTaxUnknown: false, totalEstimated: true, pickupVerified: false, availability: "Branch stock not verified" }));
}

export function isCategoryPage(title, link) {
  let path; try { path = decodeURIComponent(new URL(link).pathname); } catch { path = String(link); }
  if (isSearchResultsUrl(link)) return true;
  if (/\/(?:product-tag|product-category|tags?)(?:\/|$)/i.test(path)) return true;
  if (/(?:^|\/)categor(?:y|ies)(?:\/|$)/i.test(path)) return true;
  if (/\/(?:blogs?|articles?|guides?|news)(?:\/|$)/i.test(path)) return true;
  if (/\/collections?(?:\/|$)/i.test(path) && !/\/products?\//i.test(path)) return true;
  if (/\/(?:\d+-)?(?:אוהלים|מסכים|מחשבים|tents|monitors)\/?$/i.test(path)) return true;
  return /\/cat(?:\/|\b)|models\.aspx|product-category|[?&](?:act=cat|catid=)/i.test(link)
    || /^(?:מסכי(?:ם|\s)|מסכים|מגוון|כל המוצרים)|מסכים מומלצים|^\s*(?:all products|shop all|browse)/i.test(String(title));
}

function valuesForFacet(offer, id) {
  return [...new Set([offer.attributes?.[id] ?? []].flat().map(value => String(value).trim()).filter(Boolean))];
}

function facetDefinitions(offers, query) {
  const specificIds = new Set((productRules.find((group) => group.match.test(query))?.rules ?? []).map(({ id }) => id));
  const discovered = new Map(offers.flatMap(offer => Object.entries(offer.attributeLabels ?? {})));
  const definitions = [["condition", "Condition"], ...rulesFor(query).map(({ id, label }) => [id, id === "brand" ? "Manufacturer" : label]), ...discovered, ["retailer", "Retailer"]].filter(([, label]) => englishLabel(label));
  return { definitions: definitions.filter(([id], index) => definitions.findIndex(([other]) => other === id) === index), discovered, specificIds };
}

function requiredFacetIds(offers, query) {
  const products = offers.map(normalizeOfferFacets).filter(offer => !offer.potentialStore);
  if (!products.length) return [];
  const { definitions } = facetDefinitions(products, query);
  return definitions.map(([id]) => id).filter(id => id !== "retailer" && products.some(offer => valuesForFacet(offer, id).length));
}

function recoveryFacetIds(offers, query) {
  const products = offers.map(normalizeOfferFacets).filter(offer => !offer.potentialStore);
  const { definitions } = facetDefinitions(products, query);
  const predefined = new Set(rulesFor(query).map(rule => rule.id));
  const required = new Set(requiredFacetIds(products, query));
  return definitions.map(([id]) => id).filter(id => id !== "retailer" && products.some(offer => valuesForFacet(offer, id).length) && (required.has(id) || predefined.has(id)));
}

export function requireCompleteFacets(offers, query, required = requiredFacetIds(offers, query)) {
  return offers.filter(offer => !offer.potentialStore && required.every(id => valuesForFacet(offer, id).length));
}

export function buildFacets(offers, query) {
  offers = offers.map(normalizeOfferFacets);
  const products = offers.filter(offer => !offer.potentialStore);
  const { definitions, discovered } = facetDefinitions(offers, query);
  return definitions.map(([id, label]) => {
    const candidates = id === "retailer" ? offers : products;
    if (!candidates.length) return null;
    const counts = new Map();
    for (const offer of candidates) {
      const values = valuesForFacet(offer, id);
      if (!values.length) continue;
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (!counts.size) return null;
    return { id, label: discovered.get(id) ?? label, missingCount: candidates.filter(offer => !valuesForFacet(offer, id).length).length, options: [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })) };
  }).filter(Boolean);
}
export function shareProductSpecs(offers) {
  const identity = offer => /^\d{8,14}$/.test(offer.gtin ?? "") ? "gtin:" + offer.gtin
    : offer.productBrand && /[a-z]/i.test(offer.mpn ?? "") && /^[a-z\d][a-z\d._/-]{3,}$/i.test(offer.mpn ?? "") ? "mpn:" + String(offer.productBrand).trim().toLowerCase() + ":" + offer.mpn.toLowerCase() : null;
  const groups = new Map();
  for (const offer of offers) {
    const key = identity(offer);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(offer); groups.set(key, group);
  }
  return offers.map(offer => {
    const group = groups.get(identity(offer));
    if (!group) return offer;
    const attributes = { ...offer.attributes }, attributeLabels = { ...offer.attributeLabels };
    for (const donor of group) for (const [id, values] of Object.entries(donor.attributes)) {
      if (["retailer", "condition"].includes(id) || attributes[id] !== undefined) continue;
      const known = group.filter(item => item.attributes[id] !== undefined);
      if (!known.every(item => JSON.stringify(item.attributes[id]) === JSON.stringify(values))) continue;
      attributes[id] = values;
      if (donor.attributeLabels?.[id]) attributeLabels[id] = donor.attributeLabels[id];
    }
    return { ...offer, attributes, attributeLabels };
  });
}
function hasProductBasics(offer) {
  return !!(offer?.title && !offer.potentialStore && offer.itemPrice !== null && offer.itemPrice !== undefined && productImageUrl(offer.imageUrl || offer.imageUrls?.[0]) && merchantWebsite(offer.destinationUrl) && !isCategoryPage(offer.title, offer.destinationUrl) && !/^out of stock$/i.test(String(offer.availability).trim()));
}
function coalesceOffers(offers) {
  const merged = new Map();
  for (const current of offers.map(normalizeOfferFacets).filter(hasProductBasics)) {
    const key = `${current.category}|${current.destinationUrl}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, current); continue; }
    const base = Object.keys(current.attributes ?? {}).length > Object.keys(existing.attributes ?? {}).length ? current : existing;
    const addition = base === current ? existing : current;
    merged.set(key, { ...addition, ...base, imageUrl: base.imageUrl || addition.imageUrl, imageUrls: [...new Set([...(base.imageUrls ?? []), ...(addition.imageUrls ?? []), base.imageUrl, addition.imageUrl].filter(Boolean))], attributes: fillMissingAttributes(base.attributes, addition.attributes), attributeLabels: { ...addition.attributeLabels, ...base.attributeLabels } });
  }
  return [...merged.values()];
}
export function makeResult(query, offers) {
  const order = { local: 0, order: 1, secondHand: 2 };
  const clean = coalesceOffers(offers).sort((a, b) => order[a.category] - order[b.category]);
  const facets = buildFacets(clean, query);
  const incomplete = clean.map(offer => ({ ...offer, missingAttributes: facets.filter(facet => !valuesForFacet(offer, facet.id).length).map(facet => facet.id) }));
  return { query, resultCount: clean.length, offers: incomplete, facets, source: "live", attributesComplete: incomplete.every(offer => !offer.missingAttributes.length) };
}
export async function recoverModelSpecifications(offers, query, location, key, required = undefined, repeated = false, budget = { deadline: Infinity, remaining: 4 }) {
  const shared = shareProductSpecs(offers);
  const requiredIds = required ?? requiredFacetIds(shared, query);
  const propertyIds = [...new Set([...recoveryFacetIds(shared, query), ...requiredIds])];
  if (!propertyIds.length) return shared;
  const labels = new Map(facetDefinitions(shared, query).definitions);
  const matchingTitle = (offer, title) => offer.gtin && String(title).includes(offer.gtin)
    || offer.mpn && offer.productBrand && sameProductIdentity(`${offer.productBrand} ${offer.mpn}`, title)
    || sameProductIdentity(offer.title, title);
  const sameProduct = (offer, page) => {
    if (offer.gtin) return page.gtin === offer.gtin;
    if (offer.mpn && /[a-z]/i.test(offer.mpn)) return page.mpn?.toLowerCase() === offer.mpn.toLowerCase() && (!offer.productBrand || String(page.brand ?? "").toLowerCase() === String(offer.productBrand).toLowerCase());
    return matchingTitle(offer, page.title);
  };
  const lookupFor = offer => /^\d{8,14}$/.test(offer.gtin ?? "") ? offer.gtin : offer.productBrand && /[a-z]/i.test(offer.mpn ?? "") ? `${offer.productBrand} ${offer.mpn}` : offer.title;
  const missingOffers = shared.filter(offer => !offer.potentialStore && propertyIds.some(id => !valuesForFacet(offer, id).length));
  const batchSize = Math.max(1, Math.ceil(missingOffers.length / Math.max(1, budget.remaining)));
  const batches = new Map();
  const findSpecifications = offer => {
    const index = Math.floor(missingOffers.indexOf(offer) / batchSize);
    if (batches.has(index)) return batches.get(index);
    if (budget.remaining <= 0 || searchContext()?.providerFailure || budget.deadline <= Date.now()) return Promise.resolve([]);
    budget.remaining--;
    const lookups = [...new Set(missingOffers.slice(index * batchSize, (index + 1) * batchSize).map(lookupFor).filter(Boolean))];
    const requested = propertyIds.map(id => labels.get(id)).filter(Boolean).slice(0, 8).join(" ");
    const search = `(${lookups.map(lookup => `"${lookup.replaceAll('"', '')}"`).join(" OR ")}) ${repeated ? "manufacturer" : "technical"} specifications ${requested}`;
    const params = new URLSearchParams({ engine: "google", q: search, gl: countryCode(location)?.toLowerCase() || "", hl: "en" });
    if (typeof key === "string") params.set("api_key", key);
    const job = searchProvider(params, key, Math.min(4000, budget.deadline - Date.now())).then(data => data.organic_results ?? []).catch(() => []);
    batches.set(index, job);
    return job;
  };
  const recovered = await mapConcurrent(shared, 4, async offer => {
    if (offer.potentialStore || budget.deadline - Date.now() < 1000) return offer;
    const missing = propertyIds.filter(id => !valuesForFacet(offer, id).length);
    if (!missing.length) return offer;
    const lookup = lookupFor(offer);
    if (!lookup) return offer;
    let attributes = { ...offer.attributes }, attributeLabels = { ...offer.attributeLabels };
    const seenLinks = new Set(), results = (await findSpecifications(offer)).filter(item => {
      const link = safeHttpUrl(item.link), identity = link || `${item.title ?? ""}|${item.snippet ?? ""}`;
      if (seenLinks.has(identity)) return false;
      seenLinks.add(identity); return true;
    });
    for (const item of results.slice(0, 12)) {
      const evidence = `${item.title ?? ""} ${item.snippet ?? ""}`;
      if (!matchingTitle(offer, evidence)) continue;
      attributes = fillMissingAttributes(attributes, attributesFor(query, evidence, offer.condition, offer.merchant));
    }
    const pages = await mapConcurrent(results.filter(item => safeHttpUrl(item.link)).slice(0, 2), 2, async item => {
      if (budget.deadline - Date.now() < 500 || propertyIds.every(id => valuesForFacet({ attributes }, id).length)) return null;
      try { return await enrichProductPage(item.link); } catch { return null; }
    });
    for (const page of pages) {
      if (!page?.isProduct || page.unavailable || !sameProduct(offer, page)) continue;
      attributes = fillMissingAttributes(attributes, attributesFor(query, page.title ?? "", offer.condition, offer.merchant, page));
      attributeLabels = { ...attributeLabels, ...attributeLabelsFor(query, page.title ?? "", page) };
    }
    return { ...offer, attributes, attributeLabels };
  });
  const result = shareProductSpecs(recovered);
  if (!repeated && budget.remaining > 0 && budget.deadline - Date.now() >= 1000 && result.some(offer => propertyIds.some(id => !valuesForFacet(offer, id).length))) {
    return recoverModelSpecifications(result, query, location, key, requiredIds, true, budget);
  }
  return result;
}

export async function finishBefore(operation, deadline) {
  const remaining = Math.max(0, deadline - Date.now());
  if (!remaining) throw deadlineError();
  let timer;
  try {
    const value = await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(deadlineError()), remaining); })]);
    if (searchContext()?.signal.aborted || Date.now() >= deadline) throw deadlineError();
    return value;
  }
  finally { clearTimeout(timer); }
}

async function completeFacetAttributes(offers, query, location, key, deadline = Number.POSITIVE_INFINITY) {
  let enriched = shareProductSpecs(coalesceOffers(offers)), required = requiredFacetIds(enriched, query);
  const budget = { deadline, remaining: 4 };
  enriched = await finishBefore(() => recoverModelSpecifications(enriched, query, location, key, required, false, budget), deadline).catch(() => enriched);
  const expanded = requiredFacetIds(enriched, query);
  required = [...required, ...expanded.filter(id => !required.includes(id))];
  if (enriched.some(offer => !offer.potentialStore && required.some(id => !valuesForFacet(offer, id).length))) {
    enriched = await finishBefore(() => recoverModelSpecifications(enriched, query, location, key, required, true, budget), deadline).catch(() => enriched);
  }
  return { offers: enriched, required };
}
async function shoppingSearch(query, location, key, retailerPages, onMerchantCandidates = () => {}) {
  const code = countryCode(location);
  const searchVariant = async variant => {
    const params = new URLSearchParams({ engine: "google_shopping", q: variant, api_key: key, hl: code === "IL" ? "he" : "en", num: "40" });
    if (code) params.set("gl", code.toLowerCase());
    if (location && location !== "Current location") params.set("location", providerLocation(location));
    try { return await searchProvider(params, key, 10000); }
    catch (error) {
      if (!/unsupported.*location/i.test(error.message) || !params.has("location")) throw error;
      params.delete("location");
      return searchProvider(params, key, 7000);
    }
  };
  // Prefer the destination country's product term. English Shopping results in
  // Israel are often imports, which cannot match nearby merchant websites.
  const translated = localQuery(query, code);
  const primary = translated !== query ? translated : query;
  const searches = [await Promise.resolve(searchVariant(primary)).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason }))];
  const firstRows = searches[0].status === "fulfilled" ? [...(searches[0].value.shopping_results ?? []), ...(searches[0].value.inline_shopping_results ?? [])] : [];
  if (searches[0].status === "fulfilled" && !firstRows.some(item => isRelevantProduct(item.title, query)) && primary !== query) {
    searches.push(await Promise.resolve(searchVariant(query)).then(value => ({ status: "fulfilled", value }), reason => ({ status: "rejected", reason })));
  }
  if (searches.every(result => result.status === "rejected")) throw searches[0].reason;
  const shoppingRows = searches.map(result => result.status === "fulfilled" ? [...(result.value.shopping_results ?? []), ...(result.value.inline_shopping_results ?? [])] : []), sourceRows = shoppingRows.find(rows => rows.some(item => isRelevantProduct(item.title, query))) ?? shoppingRows.flat();
  const seenItems = new Set(), items = sourceRows.filter(item => {
    if (!isRelevantProduct(item.title, query)) return false;
    const identity = safeHttpUrl(item.link || item.product_link) || `${item.source ?? ""}|${item.title ?? ""}`;
    if (seenItems.has(identity)) return false;
    seenItems.add(identity); return true;
  });
  const localTld = countryTlds.get(code);
  const publishCandidates = offers => onMerchantCandidates(offers.filter(offer => offer.category === "order" && offer.itemPrice !== null && offer.imageUrl).map((offer, index) => {
    const host = new URL(offer.destinationUrl).hostname;
    return { name: offer.merchant, score: Number(!!localTld && host.endsWith(localTld)) * 2 + Number(code === "IL" && offer.currency === "ILS"), index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.name));
  if (typeof key === "object") {
    let needsMerchantDiscovery = false;
    const rows = await mapConcurrent(items.slice(0, 8), 6, async (item, index) => {
      const url = safeHttpUrl(item.link);
      const parsed = url ? new URL(url) : null;
      if (parsed && /(^|\.)google\./i.test(parsed.hostname) && parsed.pathname === "/goto" && item.source) {
        const destinationUrl = await resolveGoogleGoto(url);
        const offer = destinationUrl ? shoppingOffer({ ...item, link: destinationUrl }, index, query) : null;
        return offer ? [await enrichOffer(offer, query, true)].filter(Boolean) : [];
      }
      if (parsed && !/(^|\.)google\./i.test(parsed.hostname)) {
        const offer = shoppingOffer(item, index, query);
        return offer ? [await enrichOffer(offer, query, true)].filter(Boolean) : [];
      }
      // Group links need merchant discovery. Share the retailer search already in
      // progress instead of issuing a paid query for every Shopping row.
      needsMerchantDiscovery = true;
      return [];
    });
    let retailerFailure;
    let discovered = needsMerchantDiscovery ? await retailerPages.catch(error => { retailerFailure = error; return []; }) : [];
    const cannotRecover = ["quota_exhausted", "source_blocked"].includes(retailerFailure?.code) || [401, 403].includes(retailerFailure?.status);
    if (cannotRecover && !rows.flat().some(Boolean)) throw retailerFailure;
    if (!cannotRecover && needsMerchantDiscovery && !discovered.length && !rows.flat().some(Boolean)) {
      // Only recover two indexed products when the shared page search failed.
      // This is a fallback, never the old per-row eight-query fan-out.
      const merchants = new Set();
      const recoverable = items.filter(item => {
        const shop = shortRetailerName(item.source).trim().toLowerCase();
        if (!shop || /\b(?:ebay|amazon|aliexpress|temu|etsy|facebook)\b/i.test(shop) || merchants.has(shop)) return false;
        merchants.add(shop); return true;
      });
      discovered = (await mapConcurrent(recoverable.slice(0, 2), 2, async (item, index) => {
        try {
          const params = new URLSearchParams({ engine: "google", q: `${item.title} ${shortRetailerName(item.source)} buy`, gl: code?.toLowerCase() || "", hl: code === "IL" ? "he" : "en" });
          const found = await searchProvider(params, key, 4000);
          const offers = await Promise.all((found.organic_results ?? []).filter(result => isRelevantProduct(result.title, query)).slice(0, 4).map((result, n) => indexedMerchantOffer(item, result, index * 4 + n, query)));
          return offers.filter(Boolean).slice(0, 1);
        } catch { return []; }
      })).flat();
    }
    const offers = [...rows.flat().filter(Boolean), ...discovered];
    if (items.length && !offers.length) throw new Error("Merchant product pages unavailable");
    publishCandidates(offers);
    return offers;
  }
  // Resolve a bounded set of product groups concurrently; each can contain several retailers.
  const direct = items.filter(item => item.link && !/google\./i.test(new URL(safeHttpUrl(item.link) || "https://google.com").hostname));
  const grouped = items.filter(item => item.immersive_product_page_token).slice(0, 8);
  const resolved = await Promise.allSettled(grouped.map(async (item) => {
    const params = new URLSearchParams({ engine: "google_immersive_product", page_token: item.immersive_product_page_token, api_key: key });
    const detail = (await searchProvider(params, key, 2500)).product_results ?? {};
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
  const enriched = (await mapConcurrent(offers, 20, (offer, index) => index < 50 ? enrichOffer(offer, query) : offer)).filter(Boolean);
  publishCandidates(enriched);
  return enriched;
}
async function osmStores(query, location, origin) {
  if (!origin) return [];
  const cacheKey = `${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}|all-shops`, cached = osmStoreCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.value;
  const queryText = `[out:json][timeout:12];(nwr(around:15000,${origin.lat},${origin.lon})["shop"];);out center tags 80;`;
  const response = await fetchJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(queryText)}`, { headers: { "User-Agent": "ShopNearMe/0.1 (local retailer lookup)", Accept: "application/json" } }, 4000);
  const labels = { hifi: "audio", sports: "sporting goods", clothes: "clothing", houseware: "home goods", books: "book", toys: "toy", games: "game", photo: "photography", mobile_phone: "mobile phone", department_store: "department" };
  const places = (response.elements ?? []).filter(element => element.tags?.name).map(element => {
    const tags = element.tags, lat = number(element.lat ?? element.center?.lat), lon = number(element.lon ?? element.center?.lon), shop = tags.shop ?? "retail", address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ");
    return { place_id: `osm-${element.type}-${element.id}`, title: tags["name:en"] || tags.name, type: `${labels[shop] ?? shop.replaceAll("_", " ")} store`, address: address || `Near ${providerLocation(location) || "the selected location"}`, website: merchantWebsite(tags.website || tags["contact:website"]) || `https://www.openstreetmap.org/${element.type}/${element.id}`, gps_coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon } : undefined };
  });
  osmStoreCache.set(cacheKey, { at: Date.now(), value: places });
  return places;
}

async function namedLocationCoordinates(location) {
  const name = providerLocation(location).trim(), cacheKey = name.toLowerCase();
  if (!name || name === "Current location" || countries.has(cacheKey)) return null;
  const cached = geocodeCache.get(cacheKey);
  if (cached?.expires > Date.now()) return cached.point;
  if (geocodePending.has(cacheKey)) return geocodePending.get(cacheKey);
  const job = (async () => {
    try {
      const data = await fetchJson("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(name), { headers: { "Accept-Language": "en", "User-Agent": "ShopNearMe/0.1 (local product search)" } }, 1800);
      const item = data?.[0];
      if (!item || ["country", "state"].includes(item.addresstype)) return null;
      const point = validCoordinates({ lat: item.lat, lon: item.lon });
      if (point) { if (geocodeCache.size >= 100) geocodeCache.delete(geocodeCache.keys().next().value); geocodeCache.set(cacheKey, { point, expires: Date.now() + 3600000 }); }
      return point;
    } catch { return null; }
  })();
  geocodePending.set(cacheKey, job);
  try { return await job; } finally { geocodePending.delete(cacheKey); }
}

async function photonStores(names, origin) {
  if (!origin || !names.length) return [];
  const identity = value => String(value || "").toLowerCase().replace(/\s+(?:online|אונליין)$/iu, "").replace(/[^\p{L}\p{N}]/gu, "");
  const results = await Promise.allSettled(names.map(async name => {
    const cacheKey = `${identity(name)}|${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}`;
    const cached = photonStoreCache.get(cacheKey);
    if (cached?.expires > Date.now()) return cached.value;
    const params = new URLSearchParams({ q: name.replace(/[-–—]/g, " "), lat: String(origin.lat), lon: String(origin.lon), limit: "15", lang: "en" });
    const data = await fetchJson(`https://photon.komoot.io/api/?${params}`, { headers: { "User-Agent": "ShopNearMe/0.1 (nearby merchant branch lookup)", Accept: "application/json" } }, 3000);
    const places = (data.features ?? []).filter(feature => identity(feature.properties?.name) === identity(name)).map(feature => {
      const props = feature.properties, [lon, lat] = feature.geometry?.coordinates ?? [];
      const type = { N: "node", W: "way", R: "relation" }[props.osm_type];
      if (!type || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { place_id: `photon-${type}-${props.osm_id}`, title: props.name, type: props.osm_value || "store", address: [props.housenumber, props.street, props.city].filter(Boolean).join(" "), website: `https://www.openstreetmap.org/${type}/${props.osm_id}`, gps_coordinates: { latitude: lat, longitude: lon } };
    }).filter(Boolean);
    if (photonStoreCache.size >= 100) photonStoreCache.delete(photonStoreCache.keys().next().value);
    photonStoreCache.set(cacheKey, { value: places, expires: Date.now() + 3600000 });
    return places;
  }));
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

async function mapsSearch(query, location, key, coordinates, merchantCandidates = []) {
  let origin = validCoordinates(coordinates);
  if (!origin && (!location || location === "Current location")) return [];
  const target = query + " stores";
  const place = location && location !== "Current location" ? providerLocation(location) : "";
  const candidates = [...new Set(merchantCandidates.map(name => String(name || "").replace(/\s+(?:online|אונליין)$/iu, "").trim()).filter(name => name.length >= 3 && !/^(?:ebay|amazon|aliexpress|temu|etsy|facebook|google|retailer|online)$/i.test(name)))].slice(0, 2);
  const mapsParams = name => {
    const params = new URLSearchParams({ engine: "google_maps", type: "search", q: name + (place ? " near " + place : " near me"), api_key: key, hl: "en" });
    if (origin) params.set("ll", "@" + origin.lat + "," + origin.lon + ",14z");
    return params;
  };
  const localRows = data => Array.isArray(data?.local_results) ? data.local_results : Array.isArray(data?.local_results?.places) ? data.local_results.places : [];
  const packParams = new URLSearchParams({ engine: "google", q: (candidates[0] || target) + " near " + (place.replace(/,\s*/g, " ") || `${origin.lat},${origin.lon}`), hl: "en" });
  const code = countryCode(searchLocation(location, coordinates));
  if (code) packParams.set("gl", code.toLowerCase());
  if (typeof key === "string") packParams.set("api_key", key);
  // Search for branches of merchants that actually returned product offers.
  // A product-category Maps search regularly omits chains that sell the item.
  const attempts = [packParams, ...(candidates.length ? candidates.map(mapsParams) : [mapsParams(target)])];
  const quotaKey = typeof key === "string" ? key : key?.apiKey || key;
  const [settled, openStreetMapPlaces, merchantPlaces] = await Promise.all([
    Date.now() < (mapsQuotaBlockedUntil.get(quotaKey) ?? 0) ? Promise.resolve([]) : Promise.allSettled(attempts.map(attempt => searchProvider(attempt, key, attempt.get("engine") === "google_maps" ? 7000 : 4000))),
    (async () => { origin ??= await namedLocationCoordinates(location); return osmStores(query, location, origin); })().catch(() => []),
    (async () => photonStores(candidates, origin ?? await namedLocationCoordinates(location)))().catch(() => []),
  ]);
  if (settled.length && settled.every(result => result.status === "rejected" && result.reason?.status === 429)) mapsQuotaBlockedUntil.set(quotaKey, Date.now() + 3600000);
  let places = [];
  for (let index = 0; index < attempts.length; index++) {
    const result = settled[index];
    if (result.status !== "fulfilled") continue;
    const local = localRows(result.value);
    places.push(...local);
  }
  const mappedCount = places.length;
  // Merchant-specific branches must be considered before the generic store cap.
  places.push(...merchantPlaces, ...openStreetMapPlaces);
  console.info("merchant_branch_lookup", { candidates, sources: settled.map((result, index) => ({ engine: attempts[index].get("engine"), count: result.status === "fulfilled" ? localRows(result.value).length : 0, status: result.status === "fulfilled" ? "ok" : result.reason?.status || result.reason?.name || "error" })), osm: openStreetMapPlaces.length, photon: merchantPlaces.length });
  if (!places.length && settled.length && settled.every(result => result.status === "rejected")) throw settled[0].reason;
  const seen = new Set();
  return places.map((place, index) => ({ place, index, score: relevance(place, query, origin) }))
    .sort((a, b) => Number(b.index < mappedCount) - Number(a.index < mappedCount) || a.index - b.index)
    .filter(({ place, score }) => { const destination = merchantWebsite(place.website) || place.links?.directions || place.google_maps_url || place.place_id || place.data_id; const titleKey = `title:${String(place.title ?? "").trim().toLowerCase()}`, destinationKey = merchantWebsite(place.website) ? `host:${new URL(merchantWebsite(place.website)).hostname.replace(/^www\./, "")}` : ""; if (!destination || !Number.isFinite(score) || score < 2 || seen.has(titleKey) || (destinationKey && seen.has(destinationKey))) return false; seen.add(titleKey); if (destinationKey) seen.add(destinationKey); return true; })
    .slice(0, 50).map(({ place, index }) => mapOffer(place, index, query, origin));
}
async function localProductSearch(query, location, key, stores = [], deadline = Infinity) {
  const code = countryCode(location), tld = code ? countryTlds.get(code) : undefined;
  const hasLocation = location && location !== "Current location";
  const terms = code === "IL" ? "מחיר site:" + tld : tld ? "price site:" + tld : hasLocation ? "price near " + location : "price buy";
  const merchants = [...new Set(stores.map(store => {
    const site = merchantWebsite(store.destinationUrl);
    return site ? "site:" + new URL(site).hostname : '"' + shortRetailerName(store.merchant).replaceAll('"', '') + '"';
  }))].slice(0, 12);
  const restriction = merchants.length ? "(" + merchants.join(" OR ") + ")" : terms;
  // "-inurl:cat" also excludes real product URLs such as Ivory's catalog.php.
  // Keep search exclusions specific; validate every returned URL separately.
  const base = localQuery(query, code) + " " + restriction + " -inurl:category -inurl:categories -inurl:search";
  const queries = [base, query + " " + restriction + " buy"];
  const seen = new Set();
  let lastError;
  for (const q of queries) {
    if (Date.now() >= deadline) break;
    const params = new URLSearchParams({ engine: "google", q, api_key: key, hl: code === "IL" ? "he" : "en", num: "30" });
    if (code) params.set("gl", code.toLowerCase());
    let page;
    try { page = await searchProvider(params, key, Math.min(7500, Math.max(1, deadline - Date.now() - 3000)), { productDiscovery: true, backupQuery: query + (tld ? " site:" + tld : " buy") }); }
    catch (error) {
      console.info("retailer_search_failed", { attempt: queries.indexOf(q) + 1, status: error.status, reason: error.name, code: error.code });
      if (["quota_exhausted", "source_blocked"].includes(error.code) || [400, 401, 403].includes(error.status)) throw error;
      lastError = error;
      continue;
    }
    lastError = undefined;
    const domains = new Map(), offset = seen.size;
    const candidates = (page.organic_results ?? []).filter(item => {
      const link = safeHttpUrl(item.link);
      if (!link || seen.has(link) || !isRelevantProduct(item.title, query)) return false;
      seen.add(link); return true;
    }).map(item => { const domain = new URL(item.link).hostname; const rank = domains.get(domain) ?? 0; domains.set(domain, rank + 1); return { item, rank }; })
      .sort((a, b) => a.rank - b.rank).slice(0, 24).map(({ item }) => item);
    const products = (await mapConcurrent(candidates, 24, (item, index) => Date.now() < deadline ? localProduct(item, offset + index, query, location) : null)).filter(Boolean);
    console.info("retailer_discovery", { attempt: queries.indexOf(q) + 1, candidates: candidates.length, products: products.length });
    if (products.length) return products;
    if (Date.now() + 3000 < deadline) {
      const queryTerms = productWords(query).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
      const relatedCatalogs = (page.organic_results ?? []).filter(item => {
        const link = safeHttpUrl(item.link);
        return link && isCategoryPage(item.title, link) && queryTerms.some(term => includesPhrase(productWords(item.title), term));
      });
      const catalogHosts = new Set();
      const catalogs = [...relatedCatalogs, ...candidates].filter(item => {
        const link = merchantWebsite(item.link);
        if (!link || !isLocalResult(new URL(link), item, location) || catalogHosts.has(new URL(link).hostname)) return false;
        catalogHosts.add(new URL(link).hostname); return true;
      }).slice(0, 2);
      const linked = (await mapConcurrent(catalogs, 2, async item => (await catalogProductLinks(item.link, title => isRelevantProduct(title, query))).map(product => ({ ...item, ...product })))).flat();
      const recovered = (await mapConcurrent(linked, 8, (item, index) => localProduct(item, offset + 100 + index, query, location))).filter(Boolean);
      if (recovered.length) return recovered;
    }
  }
  if (lastError) throw lastError;
  return [];
}
async function runScope(scope, query, location, key, coordinates, credentials) {
  const facetDeadline = searchContext()?.deadline ?? Date.now() + 16000;
  const productLocation = searchLocation(location, coordinates);
  if (scope === "local") {
    // Local-only searches need the same product discovery as combined searches.
    const result = await runScope("all", query, location, key, coordinates, undefined);
    return { ...result, ...makeResult(query, result.offers.filter(offer => offer.category === "local")) };
  }
  let settled;
  if (scope === "all") {
    const pagesJob = finishBefore(() => localProductSearch(query, productLocation, key, [], facetDeadline), facetDeadline, []);
    let publishMerchants;
    const merchantCandidates = new Promise(resolve => { publishMerchants = resolve; });
    const shoppingJob = finishBefore(() => shoppingSearch(query, productLocation, key, pagesJob, publishMerchants), facetDeadline, []).finally(() => publishMerchants([]));
    const mapsJob = finishBefore(async () => mapsSearch(query, location, key, coordinates, await merchantCandidates), facetDeadline);
    const localJob = (async () => {
      const maps = await Promise.resolve(mapsJob).then(value => ({ status: "fulfilled", value }), () => ({ status: "rejected" }));
      if (maps.status !== "fulfilled" || !maps.value.length) return [];
      return finishBefore(() => localProductSearch(query, productLocation, key, maps.value, facetDeadline), facetDeadline, []);
    })();
    const [shopping, maps, retailerPages, secondHand, targeted] = await Promise.allSettled([shoppingJob, mapsJob, pagesJob, ebaySearch(query, productLocation, credentials), localJob]);
    if (targeted.status === "fulfilled" && targeted.value.length) {
      settled = [shopping, maps, { status: "fulfilled", value: [...(retailerPages.status === "fulfilled" ? retailerPages.value : []), ...targeted.value] }, secondHand];
    } else settled = [shopping, maps, retailerPages, secondHand];
  } else if (scope === "online") {
    const pagesJob = finishBefore(() => localProductSearch(query, productLocation, key, [], facetDeadline), facetDeadline, []);
    const [shopping, retailerPages, secondHand] = await Promise.allSettled([
      finishBefore(() => shoppingSearch(query, productLocation, key, pagesJob), facetDeadline, []), pagesJob, ebaySearch(query, productLocation, credentials),
    ]);
    settled = [shopping, retailerPages, secondHand];
  } else {
    const job = scope === "local" ? mapsSearch(query, location, key, coordinates) : localProductSearch(query, productLocation, key);
    settled = await Promise.allSettled([job]);
  }
  if (settled.every(({ status }) => status === "rejected")) throw settled[0].reason;
  const value = index => settled[index]?.status === "fulfilled" ? settled[index].value : [];
  let offers = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
  if (scope === "all") {
    const online = [...value(0), ...value(2)], maps = value(1);
    offers = [...mergeLocalProducts(maps, nearbyProductOffers(maps, online)), ...online, ...value(3)];
  }
  const completed = await completeFacetAttributes(offers, query, location, key, facetDeadline), enriched = completed.offers, required = completed.required;
  const result = makeResult(query, await localizeOffers(enriched.map(offer => ({ ...offer, availability: offer.availability === "Out of stock" ? "Out of stock" : "" })), productLocation), required);
  const labels = scope === "online" ? ["Online products", "Retailer product pages", "Marketplace products"]
    : scope === "local" ? ["Nearby products"] : scope === "local-products" ? ["Retailer product pages"]
    : ["Online products", "Nearby product availability", "Retailer product pages", "Marketplace products"];
  const quotaFailure = settled.find(entry => entry.status === "rejected" && entry.reason?.code === "quota_exhausted");
  result.sourceStatus = settled.map((entry, index) => ({ source: labels[index], status: entry.status === "fulfilled" ? "completed" : "failed", ...(entry.status === "rejected" ? { code: entry.reason?.code || (entry.reason?.name === "TimeoutError" ? "search_timeout" : "search_unavailable") } : {}) }));
  result.warnings = quotaFailure
    ? [`Search provider quota has been used up.${quotaFailure.reason.resetAt ? ` It will reset ${quotaFailure.reason.resetAt}.` : " The provider did not supply a reset time."}`]
    : settled.flatMap((entry, index) => entry.status === "rejected" ? [labels[index] + (entry.reason?.code === "source_blocked"
      ? " could not be searched because the search provider was blocked by Google (CAPTCHA). Results are incomplete."
      : " could not be searched. Please try again.")] : []);
  result.partialFailure = settled.some(entry => entry.status === "rejected");
  if (result.warnings.some(warning => warning.includes("(CAPTCHA)"))) result.warnings = [...result.warnings.filter(warning => !warning.includes("(CAPTCHA)")), "Google product and retailer search was blocked (CAPTCHA). Other available sources are shown; results are incomplete."];
  if (searchContext()?.backupQuota) result.warnings.push("Backup search allowance has been used up." + (searchContext().backupQuota.reset ? ` It renews on ${searchContext().backupQuota.reset}.` : ""));
  if ((!location || location === "Current location") && !coordinates && scope !== "online") result.warnings.push("Choose a location to include nearby products.");
  return result;
}
export async function searchCatalog(query, location, apiKey = {}, coordinates, credentials, scope = "all") { const safeScope = ["all", "online", "local", "local-products"].includes(scope) ? scope : "all", point = validCoordinates(coordinates), cacheKey = `${safeScope}|${query.trim().toLowerCase()}|${String(location || "").trim().toLowerCase()}|${point ? `${point.lat.toFixed(4)},${point.lon.toFixed(4)}` : ""}`; const cached = cache.get(cacheKey); if (cached && Date.now() - cached.at < CACHE_MS) return cached.value; if (inFlight.has(cacheKey)) return inFlight.get(cacheKey); const request = withSearchBudget(() => runScope(safeScope, query.trim(), location, apiKey, point, credentials)).then((value) => { if (!value.partialFailure && !value.warnings?.length) cache.set(cacheKey, { at: Date.now(), value }); return value; }).finally(() => inFlight.delete(cacheKey)); inFlight.set(cacheKey, request); return request; }

function verifiedRetailOffer(record, query) {
  const { page, link, id } = record;
  const merchant = shortRetailerName(new URL(link).hostname.replace(/^www\./, ""));
  return {
    id: `retail-${id}`, category: "order", title: page.title || record.title, merchant,
    subtitle: page.specificationText?.slice(0, 150) || "", imageUrl: page.imageUrl, imageUrls: page.imageUrls ?? [],
    destinationUrl: link, linkLabel: "View product", itemPrice: page.price, totalPrice: page.price,
    shippingPrice: null, currency: page.currency, totalEstimated: true, priceVerified: true,
    availability: page.availability || "", rating: 0, reviewCount: 0,
    gtin: page.gtin, mpn: page.mpn, productBrand: page.brand,
    attributes: attributesFor(query, `${page.title} ${page.specificationText ?? ""}`, undefined, merchant, page),
    attributeLabels: attributeLabelsFor(query, page.title || record.title, page),
  };
}

// Production entry point. The old searchCatalog remains for legacy consumers;
// this path does not call shoppingSearch, mapsSearch or localProductSearch.
export async function searchRetailCatalog(query, location, config = {}, coordinates, credentials, scope = "all") {
  scope = ["all", "online", "local", "local-products"].includes(scope) ? scope : "all";
  query = query.trim();
  const pointKey = validCoordinates(coordinates);
  const requestKey = `retail-v2|${scope}|${query.toLowerCase()}|${location || ""}|${pointKey ? `${pointKey.lat},${pointKey.lon}` : ""}`;
  if (inFlight.has(requestKey)) return inFlight.get(requestKey);
  const request = withSearchBudget(async () => {
    const deadline = searchContext().deadline, point = validCoordinates(coordinates);
    const productLocation = searchLocation(location, point), country = countryCode(productLocation);
    const translated = localQuery(query, country);
    // Do not send half-translated noun phrases such as "שעון repair kit".
    const localizedQuery = /[\u0590-\u05ff]/.test(translated) && !/[a-z]{3,}/i.test(translated) ? translated : query;
    const tld = countryTlds.get(country);
    const retailQuery = country ? `${localizedQuery} ${country === "IL" ? "מחיר" : "price"}${tld ? ` site:${tld}` : ` ${country}`}` : `${query} price`;
    const nearbyQuery = scope !== "online" && scope !== "local-products" && (point || (location && location !== "Current location")) ? `${query} stores near ${providerLocation(productLocation)}` : undefined;
    const discoveryJob = (config.provider === "octoparse" ? discoverOctoparseProducts : discoverRetailProducts)({ query, country, localizedQuery, retailQuery, nearbyQuery, config, relevant: isRelevantProduct, isCatalog: isCategoryPage, deadline });
    const marketplaceJob = scope === "local" || scope === "local-products" ? Promise.resolve([]) : ebaySearch(query, productLocation, credentials);
    const placesJob = config.provider === "octoparse" || scope === "online" || scope === "local-products" || (!point && (!location || location === "Current location")) ? Promise.resolve([]) : (async () => {
      const origin = point || await namedLocationCoordinates(location);
      return (await osmStores(query, productLocation, origin)).map((place, index) => mapOffer(place, index, query, origin));
    })();
    const [discoveryState, marketplaceState, placesState] = await Promise.allSettled([discoveryJob, marketplaceJob, placesJob]);
    const discovery = discoveryState.status === "fulfilled" ? discoveryState.value : { products: [], sourceStatus: [{ source: "retail", status: "failed", code: discoveryState.reason?.code || "search_unavailable" }], diagnostics: {} };
    const online = discovery.products.map(record => verifiedRetailOffer(record, query));
    const origin = point || (nearbyQuery && discovery.places?.length ? await namedLocationCoordinates(location) : undefined);
    const places = [...(placesState.status === "fulfilled" ? placesState.value : []), ...(discovery.places ?? []).map((place, index) => mapOffer(place, index, query, origin))];
    const localOffers = scope === "online" || scope === "local-products" ? [] : mergeLocalProducts(places, nearbyProductOffers(places, online));
    // A merchant can publish its own store coordinates even when the map index has no entry.
    if (point && scope !== "online" && scope !== "local-products") for (const record of discovery.products) {
      const offer = online.find(item => item.id === `retail-${record.id}`);
      if (!offer || localOffers.some(item => item.destinationUrl === offer.destinationUrl)) continue;
      const branch = (record.page.locations ?? []).map(place => ({ ...place, distance: distanceMiles(point, place) })).filter(place => place.distance <= 50).sort((a, b) => a.distance - b.distance)[0];
      if (branch) localOffers.push({ ...offer, id: `${offer.id}-pickup`, category: "local", distanceMiles: branch.distance, pickupVerified: false, subtitle: branch.address || offer.subtitle });
    }
    const marketplace = marketplaceState.status === "fulfilled" ? marketplaceState.value : [];
    const offers = scope === "local" ? localOffers : [...localOffers, ...online, ...marketplace];
    // Legacy specification recovery calls the old SERP provider. The Octoparse
    // path extracts source-backed attributes without silently calling Bright Data.
    const completed = config.provider === "octoparse" ? { offers: shareProductSpecs(coalesceOffers(offers)) } : await completeFacetAttributes(offers, query, location, config, deadline);
    const result = makeResult(query, await localizeOffers(completed.offers, productLocation));
    result.sourceStatus = [
      { source: "Retailer products", status: discovery.continuation ? "pending" : online.length || (discovery.sourceStatus.some(item => item.status === "completed") && !discovery.diagnostics.candidates) ? "completed" : "failed", products: online.length },
      ...(scope === "online" || scope === "local-products" ? [] : [{ source: "Nearby product availability", status: discovery.sourceStatus.some(source => source.source === "Nearby branches via Octoparse" && source.status === "pending") ? "pending" : placesState.status === "fulfilled" || localOffers.length ? "completed" : "failed", products: localOffers.length }]),
      ...(scope === "local" || scope === "local-products" ? [] : [{ source: "Marketplace products", status: marketplaceState.status === "fulfilled" ? "completed" : "failed", products: marketplace.length }]),
    ];
    result.discoveryStatus = discovery.sourceStatus;
    if (discovery.continuation) result.pendingSearch = { continuation: discovery.continuation, nextPollAt: discovery.nextPollAt };
    if (config.provider === "octoparse") result.sourceStatus.push(...discovery.sourceStatus.filter(source => source.status === "failed"));
    result.partialFailure = result.sourceStatus.some(source => source.status === "failed");
    result.warnings = result.sourceStatus.filter(source => source.status === "failed").map(source => source.source + " could not be searched. Please try again.");
    if (discovery.sourceStatus.some(source => source.code === "quota_exhausted")) result.warnings.push("Search provider quota has been used up. The provider did not supply a reset time.");
    if ((!location || location === "Current location") && !point && scope !== "online") result.warnings.push("Choose a location to include nearby products.");
    if (searchContext().backupQuota) result.warnings.push("Backup search allowance has been used up." + (searchContext().backupQuota.reset ? ` It renews on ${searchContext().backupQuota.reset}.` : ""));
    console.info("retail_search", { ...discovery.diagnostics, sources: discovery.sourceStatus, online: online.length, local: localOffers.length });
    return result;
  }).finally(() => inFlight.delete(requestKey));
  inFlight.set(requestKey, request);
  return request;
}
