// Facets are discovered from named product properties, not a finite category list.
// Aliases only consolidate equivalent labels; unrecognized properties remain usable.
const aliases = [
  ["brand", "Manufacturer", /^(brand|manufacturer|make|יצרן|מותג)$/i],
  ["screenSize", "Screen size", /^(screen size(?: in inches)?|display size|screen diagonal|display diagonal|גודל מסך|אינצ')$/i],
  ["size", "Size", /^(size|גודל)$/i],
  ["displayType", "Panel type", /^(panel type|display type|display technology|סוג פאנל|סוג הצג)$/i],
  ["resolution", "Resolution", /^(resolution|maximum resolution|display resolution|native resolution|רזולוציה|רזולוציית מסך)$/i],
  ["refreshRate", "Refresh rate", /^(hz|refresh rate|maximum refresh rate|קצב רענון|קצב ריענון מרבי)$/i],
  ["responseTime", "Response time", /^(response time|זמן תגובה)$/i],
  ["finish", "Surface finish", /^(screen finish|glass finish|screen coating|surface finish|display surface|screen surface|finish|ציפוי מסך)$/i],
  ["mounting", "Mounting / VESA", /^(vesa|vesa mounting(?: dimensions)?|vesa mount|vesa mount compatibility|wall mount|wall mountable|mounting type|mounting interface|תלייה|תקן תלייה)$/i],
  ["standAdjustments", "Stand adjustments", /^(stand adjustments?|ergonomics|adjustable stand|כוונון מעמד)$/i],
  ["heightAdjustment", "Height adjustment", /^(height adjustment|height adjustable|כוונון גובה)$/i],
  ["tilt", "Tilt", /^(tilt|tilt adjustment|הטיה)$/i],
  ["swivel", "Swivel", /^(swivel|swivel adjustment|סיבוב)$/i],
  ["pivot", "Pivot", /^(pivot|pivot adjustment)$/i],
  ["speakers", "Built-in speakers", /^(speakers|with speakers|built in speakers?|integrated speakers|רמקולים מובנים|עם רמקולים|רמקולים)$/i],
  ["adaptiveSync", "Adaptive sync", /^(adaptive sync(?: technology)?|synchronization|variable refresh rate|vrr|sync technology)$/i],
  ["gSync", "G-Sync support", /^(?:nvidia )?g sync(?: compatible| support)?$/i],
  ["freeSync", "FreeSync support", /^(?:amd )?free ?sync(?: premium| support)?$/i],
  ["ports", "Ports", /^(ports|connections|connectors|connector type|inputs|audio\/video inputs|video inputs|display inputs|חיבורים|כניסות|סוגי החיבורים|סוגי חיבורים|חיבור usb)$/i],
  ["connectivity", "Connectivity", /^(connectivity|wireless technology|קישוריות)$/i],
  ["weight", "Weight", /^(weight|item weight|product weight|net weight|משקל)$/i],
  ["dimensions", "Dimensions", /^(dimensions|product dimensions|item dimensions|מידות)$/i],
  ["material", "Material", /^(material|materials|חומר)$/i],
  ["color", "Color", /^(colou?r|צבע)$/i],
  ["capacity", "Capacity", /^(capacity|volume|נפח|קיבולת)$/i],
  ["batteryLife", "Battery life", /^(battery life|battery runtime|run time|runtime|זמן עבודה)$/i],
  ["waterResistance", "Water resistance", /^(water resistance|waterproof rating|water resistance rating|עמידות במים)$/i],
  ["power", "Power", /^(power|power consumption|rated power|הספק)$/i],
  ["width", "Width", /^(width|רוחב)$/i], ["height", "Height", /^(height|גובה)$/i],
  ["depth", "Depth", /^(depth|עומק)$/i], ["length", "Length", /^(length|אורך)$/i],
  ["chairsIncluded", "Chairs included", /^(chairs included|includes chairs)$/i],
  ["extendable", "Extendable", /^(extendable|extending|extension leaf)$/i],
  ["aspectRatio", "Aspect ratio", /^(aspect ratio|יחס גובה רוחב)$/i],
  ["curvature", "Screen shape", /^(screen shape|צורת מסך)$/i],
  ["touchscreen", "Touchscreen", /^(touchscreen|touch screen|מסך מגע)$/i],
  ["brightness", "Brightness", /^(brightness|בהירות)(?:\s*\(.*\))?$/i],
  ["contrastRatio", "Contrast ratio", /^(contrast ratio|ניגודיות)$/i],
  ["hdr", "HDR", /^hdr$/i],
  ["features", "Features", /^(features|תכונות|תכונות נוספות)$/i],
  ["viewingAngle", "Viewing angle", /^(viewing angle|זווית צפיה)$/i],
  ["powerSupply", "Power supply", /^(power supply|סוג שנאי)$/i],
  ["resolution", "Resolution", /^רזולוצית מסך$/],
  ["displayType", "Panel type", /^טכנולוגיית פאנל$/],
  ["aspectRatio", "Aspect ratio", /^יחס תצוגה$/],
  ["contrastRatio", "Contrast ratio", /^יחס ניגודיות$/],
  ["colorGamut", "Color gamut", /^כיסוי צבע$/],
  ["colorDepth", "Color depth", /^עומק צבע$/],
  ["viewingAngle", "Viewing angle", /^זוויות צפייה$/],
  ["ports", "Ports", /^(חיבורים ויציאות|יציאות וחיבורים)$/],
  ["webcam", "Built-in webcam", /^מצלמה מובנית$/],
  ["microphone", "Microphone", /^מיקרופון מובנה$/],
  ["standAdjustments", "Stand adjustments", /^(כוונון סטנד|מעמד|עיצוב רגלית|כיוון מלא של הסטנד|tilt swivel pivot height adjustment)$/i],
  ["mounting", "Mounting / VESA", /^(תושבת קיר|הרכבה)$/],
  ["packagedWeight", "Packaged weight", /^משקל אריזה$/],
  ["power", "Power", /^צריכת חשמל$/],
  ["powerSupply", "Power supply", /^ספק כוח$/],
  ["adaptiveSync", "Adaptive sync", /^(טכנולוגיית סינכרון|תמיכה דינמית)$/],
  ["gSync", "G-Sync support", /^תאימות ל G Sync$/i],
  ["environmentalStandards", "Environmental standards", /^תקנים סביבתיים$/],
  ["ergonomicStandards", "Ergonomic standards", /^תקנים ארגונומיים$/],
  ["bezelWidth", "Bezel width", /^רוחב מסגרת$/],
  ["type", "Product type", /^סוג מוצר$/],
];
const nonSpecification = /(?:price|shipping|delivery|returns?|warranty|seller|retailer|review|rating|attribute name|sku|\bupc\b|\bean\b|gtin|mpn|model(?: number)?|product id|product line|unit type|unit quantity|asin|url|description|overview|about|style|מחיר|משלוח|אחריות|קטלוג|יבואן|מבצע|הערה|מק["״]?ט)/i;
export function cleanText(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff))).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}
export function specificationPairs(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(specificationPairs);
  const name = value.name ?? value.title ?? value.key;
  const content = value.value ?? value.values ?? value.description;
  if (name && content !== undefined) return [{ name, value: content, unit: value.unitText ?? value.unit ?? "" }];
  return Object.entries(value).flatMap(([key, item]) => {
    if (["@type", "@context", "@id"].includes(key)) return [];
    return typeof item === "object" && !Array.isArray(item) ? specificationPairs(item) : [{ name: key, value: item }];
  });
}
function valueText(value) {
  if (value && typeof value === "object") return cleanText(value.value ?? value.name ?? "");
  return cleanText(value);
}
function normalizedValue(id, raw, unit = "") {
  let value = cleanText(`${valueText(raw)} ${unit}`).replace(/\b(?:inches|inch)\b|אינטש|אינץ['׳]?/gi, "in").replace(/(\d)\s*["″]/g, "$1 in").replace(/\bkilograms?\b|ק["״]ג/gi, "kg").replace(/\bcentimeters?\b|ס["״]מ/gi, "cm").replace(/\bmillimeters?\b|מ["״]מ/gi, "mm");
  if (/^(?:yes|true|supported|כן|יש|קיים)$/i.test(value)) return "Yes";
  if (/^(?:no|false|not supported|לא|אין|ללא)$/i.test(value)) return "No";
  if (/^(?:n\/a|unknown|not specified|not available|-|null|undefined)$/i.test(value)) return "";
  value = value.replace(/(\d)\s*(kg|cm|mm|hz|ms|gb|tb|mah|w|in)\b/gi, (_, n, u) => `${n} ${{hz:"Hz",gb:"GB",tb:"TB",mah:"mAh",w:"W"}[u.toLowerCase()] ?? u.toLowerCase()}`);
  if (id === "weight" && /^\d+(?:\.\d+)?\s*g$/i.test(value)) return `${parseFloat(value) / 1000} kg`;
  if (id === "brand") return value.toUpperCase();
  if (id === "color") return ({ "שחור":"Black", "לבן":"White", "כחול":"Blue", "אדום":"Red", "ירוק":"Green", "אפור":"Gray" })[value] ?? value;
  if (id === "curvature") return ({ "שטוח":"Flat", "קעור":"Curved" })[value] ?? value;
  if (id === "mounting") value = value.replace(/(\d)\s*[xX×]\s*(\d)/g, "$1 x $2");
  if (id === "adaptiveSync") value = value.replace(/(?:NVIDIA|AMD|™)/gi, "").replace(/g[- ]?sync/gi, "G-Sync").replace(/freesync/gi, "FreeSync").trim();
  if (id === "ports") value = value.replace(/displayport/gi, "DisplayPort").replace(/hdmi/gi, "HDMI").replace(/usb[- ]c/gi, "USB-C");
  if (id === "screenSize" && /^\d+(?:\.\d+)?(?:\s*in)?$/i.test(value)) return `${parseFloat(value)} in`;
  if (id === "responseTime") { value = value.replace(/milliseconds?/gi, "ms"); if (/^0\s*ms$/i.test(value)) return ""; }
  if (id === "speakers" && /^built[- ]in speakers?$/i.test(value)) return "Yes";
  if (id === "resolution") {
    value = value.replace(/\s*\((?:2K|QHD|WQHD|UHD|FHD|4K)\)/gi, "");
    if (/^(?:2K\s*)?(?:W?QHD\s*)?\(?2560\s*[x×]\s*1440\)?(?:\s*W?QHD)?$|^Wide Quad HD\s*\(1440p\)$/i.test(value)) return "1440p";
    if (/^(?:qhd|wqhd|1440p|2560\s*[x×]\s*1440)$/i.test(value)) return "1440p";
    if (/^(?:uhd|4k|3840\s*[x×]\s*2160)$/i.test(value)) return "4K";
    if (/^(?:fhd|full hd|1080p|1920\s*[x×]\s*1080)$/i.test(value)) return "1080p";
  }
  if (id === "finish") { if (/^(?:matt|matte|anti glare|anti-glare)$/i.test(value)) return "Matte / anti-glare"; if (/^glossy$/i.test(value)) return "Glossy"; }
  return value;
}
export function structuredAttributes(pairs) {
  const attributes = {}, labels = {};
  for (const pair of pairs ?? []) {
    const rawName = cleanText(pair.name).replace(/\b(?:exited tooltip|opens in a new window)\b/gi, "").replace(/[:：]$/, "").replace(/[-_]/g, " ").trim();
    const unit = rawName.match(/\((inches|in|mm\.?|cm|kg|lbs?\.?|Hz|ms|watts)\)$/i)?.[1];
    const name = rawName.replace(/\((inches|in|mm\.?|cm|kg|lbs?\.?|Hz|ms|watts)\)$/i, "").replace(/^monitor\s+/i, "").trim();
    if (!name || name.length > 64 || /\uFFFD/.test(name) || nonSpecification.test(name) || /^(?:parameter|specification|פרמטר|דגם|מספר ספק|קישור ליצרן|זמן אספקה|תנאי תשלום|יתרון|תועלת)$/i.test(name)) continue;
    const alias = aliases.find(([, , match]) => match.test(name));
    const id = alias?.[0] ?? `spec:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}`;
    const values = [pair.value].flat().flatMap(raw => {
      const text = valueText(raw);
      const parts = ["ports", "connectivity", "adaptiveSync", "standAdjustments", "features"].includes(id) ? text.split(/[,;|]|\s+(?:and|&|\/)\s+/i) : [raw];
      return parts.map(part => normalizedValue(id, part, pair.unit || (/^\d+(?:\.\d+)?$/.test(valueText(part)) ? unit : "")));
    }).filter(value => value && value.length <= 100 && !/https?:|www\.|\uFFFD|במלאי|out of stock|in stock/i.test(value));
    if (!values.length) continue;
    const basePorts = id === "ports" ? values.flatMap(value => value.match(/HDMI|DisplayPort|USB-C|Thunderbolt|DVI|VGA/gi) ?? []) : [];
    attributes[id] = [...new Set([...[attributes[id] ?? []].flat(), ...values, ...basePorts])];
    labels[id] = alias?.[1] ?? name.charAt(0).toUpperCase() + name.slice(1);
  }
  return { attributes, labels };
}
export function extractNamedSpecifications(html, product = {}) {
  const pairs = specificationPairs(product.additionalProperty);
  for (const key of ["brand", "manufacturer", "material", "color", "weight", "width", "height", "depth", "size"]) {
    const value = product[key];
    if (value !== undefined) pairs.push({ name: key, value: value?.name ?? value?.value ?? value, unit: value?.unitText ?? "" });
  }
  // Named rows only; never assign specifications from a whole page's prose or recommendations.
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  for (const table of stripped.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => cleanText(cell[1])));
    // Benefit/comparison tables describe marketing claims, not named specifications.
    if (rows[0]?.some(cell => /^(benefit|advantage|why it matters|יתרון|תועלת|למה זה חשוב)$/i.test(cell))) continue;
    for (const cells of rows) if (cells.length === 2) pairs.push({ name: cells[0], value: cells[1] });
  }
  for (const row of stripped.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) pairs.push({ name: cleanText(row[1]), value: cleanText(row[2]) });
  return pairs;
}

export function monitorAttributes(query, text) {
  if (!/monitor|television|\btv\b|מסך/i.test(query)) return { attributes: {}, labels: {} };
  const pairs = [], add = (name, value) => { if (value) pairs.push({ name, value }); };
  add("Screen finish", text.match(/\b(?:glossy|matte|anti[- ]glare)\b/i)?.[0]);
  add("VESA mounting", text.match(/VESA(?:\s+(?:mount|mounting|compatible))?\s*[:-]?\s*(\d{2,3}\s*[x×]\s*\d{2,3})/i)?.[1]);
  if (!pairs.some(p => p.name === "VESA mounting") && /wall[- ]mountable|VESA compatible/i.test(text)) add("Wall mountable", "Yes");
  for (const [name, yes, no] of [
    ["Built-in speakers", /(?:built[- ]in|integrated)\s+speakers|speakers\s*:\s*yes/i, /(?:no|without)\s+(?:built[- ]in\s+)?speakers|speakers\s*:\s*no/i],
    ["Height adjustment", /height[- ]adjustable|height adjustment/i, /fixed height|no height adjustment/i],
    ["Tilt", /\btilt(?:ing)?\b/i, /no tilt/i], ["Swivel", /\bswivel\b/i, /no swivel/i], ["Pivot", /\bpivot\b/i, /no pivot/i],
  ]) add(name, no.test(text) ? "No" : yes.test(text) ? "Yes" : "");
  add("Ports", [...new Set(text.match(/HDMI(?:\s*\d\.\d)?|DisplayPort(?:\s*\d\.\d)?|USB[- ]C|Thunderbolt(?:\s*\d)?|\bDVI\b|\bVGA\b|3\.5\s*mm/gi) ?? [])]);
  add("Adaptive sync", [...new Set(text.match(/G[- ]?Sync(?: Compatible)?|FreeSync(?: Premium(?: Pro)?)?/gi) ?? [])]);
  return structuredAttributes(pairs);
}
