import { englishLabel, specificationText } from "./facet-language.mjs";
import { load } from "cheerio";
// Facets are discovered from named product properties, not a finite category list.
// Aliases only consolidate equivalent labels; unrecognized properties remain usable.
const aliases = [
  ["brand", "Manufacturer", /^(brand(?: name)?|manufacturer|make|יצרן|מותג)$/i],
  ["condition", "Condition", /^(condition|item condition)$/i],
  ["screenSize", "Screen size", /^(screen size(?: in inches)?|display size|screen diagonal|display diagonal|גודל מסך|אינצ')$/i],
  ["size", "Size", /^(size|גודל)$/i],
  ["displayType", "Panel type", /^(panel type|display type|screen type|display technology|סוג פאנל|סוג הצג)$/i],
  ["movement", "Movement", /^(movement|clock movement)$/i],
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
  ["memory", "Memory / RAM", /^(?:(?:installed|system|total) )?(?:memory|ram|memory size|memory capacity|ram size|ram capacity|זיכרון(?: פנימי)?|זכרון(?: פנימי)?|ראם)$/i],
  ["storage", "Storage", /^(?:storage|storage capacity|internal storage|ssd|ssd capacity|solid state drive capacity|hard drive capacity|disk capacity|אחסון|נפח אחסון|כונן)$/i],
  ["weight", "Weight", /^(weight|item weight|product weight|net weight|משקל)$/i],
  ["dimensions", "Dimensions", /^(dimensions|product dimensions|item dimensions(?: d x w x h)?|מידות)$/i],
  ["material", "Material", /^(material(?: type)?|materials|חומר)$/i],
  ["color", "Color", /^(colou?r|צבע)$/i],
  ["capacity", "Capacity", /^(capacity|volume|נפח|קיבולת)$/i],
  ["voltage", "Voltage", /^(voltage|nominal voltage|battery voltage|מתח|מתח סוללה)$/i],
  ["batteryCapacity", "Battery capacity", /^(battery capacity|קיבולת סוללה)$/i],
  ["batteryType", "Battery type", /^(battery type|סוג סוללה)$/i],
  ["type", "Product type", /^(type|product type|סוג מוצר)$/i],
  ["batteryLife", "Battery life", /^(battery life|battery runtime|run time|runtime|זמן עבודה)$/i],
  ["waterResistance", "Water resistance", /^(water resistance|waterproof rating|water resistance rating|עמידות במים)$/i],
  ["power", "Power", /^(power|power consumption|rated power|max(?:imum)? wattage|maximum power|wattage|הספק)$/i],
  ["packSize", "Pack size", /^(pack size|number (?:in pack|of items|of pieces)|unit count)$/i],
  ["width", "Width", /^(?:(?:item|product) )?(width|רוחב)$/i], ["height", "Height", /^(?:(?:item|product) )?(height|גובה)$/i],
  ["depth", "Depth", /^(?:(?:item|product) )?(depth|עומק)$/i], ["length", "Length", /^(?:(?:item|product) )?(length|אורך)$/i],
  ["chairsIncluded", "Chairs included", /^(chairs included|includes chairs)$/i],
  ["extendable", "Extendable", /^(extendable|extending|extension leaf)$/i],
  ["aspectRatio", "Aspect ratio", /^(aspect ratio|יחס גובה רוחב)$/i],
  ["curvature", "Screen shape", /^(screen shape|צורת מסך)$/i],
  ["touchscreen", "Touchscreen", /^(touchscreen|touch screen|מסך מגע)$/i],
  ["brightness", "Brightness", /^(brightness|בהירות)(?:\s*\(.*\))?$/i],
  ["contrastRatio", "Contrast ratio", /^(contrast ratio|ניגודיות)$/i],
  ["hdr", "HDR", /^hdr$/i],
  ["features", "Features", /^(features|additional features|תכונות|תכונות נוספות)$/i],
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
const nonSpecification = /(?:price|cost|cybersecurity|insurance|protection plan|purchase|payment|shipping|delivery|returns?|warranty|seller|retailer|review|rating|attribute name|sku|\bupc\b|\bean\b|gtin|mpn|model(?: number)?|product id|product line|unit type|unit quantity|asin|url|description|overview|about|style|מחיר|משלוח|אחריות|קטלוג|יבואן|מבצע|הערה|מק["״]?ט)/i;
const businessMetadata = /\b(?:contact|telephone|phone|fax|email|opening hours|business hours|working hours|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:טלפון|פקס|שעות פתיחה|שעות פעילות|צור קשר)/i;
const retailerDetails = /^(?:ships? from|(?:store|branch|office) (?:address|location|directions|entrances?)|entrances? from (?:the )?streets?|(?:כתובת|מיקום) (?:ה?חנות|ה?סניף)|דרכי הגעה)$/i;
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
export function conditionValue(value) {
  const raw = cleanText(value && typeof value === "object" ? value['@id'] ?? value.name ?? value.value : value);
  const condition = raw.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase().replace(/[-_\s]/g, '');
  return ({ newcondition: 'New', new: 'New', brandnew: 'New', unused: 'New', neverused: 'New', newwithtags: 'New', חדש: 'New',
    usedcondition: 'Used', used: 'Used', preowned: 'Used', secondhand: 'Used', occasion: 'Used', gebraucht: 'Used', משומש: 'Used',
    refurbishedcondition: 'Refurbished', refurbished: 'Refurbished', renewed: 'Refurbished', מחודש: 'Refurbished',
    damagedcondition: 'Damaged', damaged: 'Damaged', openbox: 'Open box' })[condition] ?? '';
}
function normalizedValue(id, raw, unit = "") {
  if (id === 'condition') return conditionValue(raw);
  let value = cleanText(`${valueText(raw)} ${unit}`).replace(/\b(?:inches|inch)\b|אינטש|אינץ['׳]?/gi, "in").replace(/(\d)\s*["″]/g, "$1 in").replace(/\bkilograms?\b|ק["״]ג/gi, "kg").replace(/\bcentimeters?\b|ס["״]מ/gi, "cm").replace(/\bmillimeters?\b|מ["״]מ/gi, "mm");
  if (/^(?:yes|true|supported|כן|יש|קיים)$/i.test(value)) return "Yes";
  if (/^(?:no|false|not supported|לא|אין|ללא)$/i.test(value)) return "No";
  if (/^(?:n\/?a|unknown|not specified|not available|-|null|undefined)$/i.test(value)) return "";
  value = value.replace(/(\d)\s*(kg|cm|mm|hz|ms|gb|tb|mah|w|in)\b/gi, (_, n, u) => `${n} ${{hz:"Hz",gb:"GB",tb:"TB",mah:"mAh",w:"W"}[u.toLowerCase()] ?? u.toLowerCase()}`);
  if (id === "weight" && /^\d+(?:\.\d+)?\s*g$/i.test(value)) return `${parseFloat(value) / 1000} kg`;
  if (id === "brand") return value.toUpperCase();
  if (id === "color") return ({ "שחור":"Black", "לבן":"White", "כחול":"Blue", "אדום":"Red", "ירוק":"Green", "אפור":"Gray" })[value] ?? value;
  if (id === "curvature") return ({ "שטוח":"Flat", "קעור":"Curved" })[value] ?? value;
  if (id === "mounting") value = value.replace(/(\d)\s*[xX×]\s*(\d)/g, "$1 x $2");
  if (id === "adaptiveSync") value = value.replace(/(?:NVIDIA|AMD|™)/gi, "").replace(/g[- ]?sync/gi, "G-Sync").replace(/freesync/gi, "FreeSync").trim();
  if (id === "ports") value = value.replace(/displayport/gi, "DisplayPort").replace(/hdmi/gi, "HDMI").replace(/usb[- ]c/gi, "USB-C");
  if (id === "voltage") value = value.replace(/(\d)\s*v(?:olts?)?\b/gi, "$1 V");
  if (id === "type" && /^rechargeable batter(?:y|ies)$/i.test(value)) value = "Battery";
  if (id === "packSize" && /^\d+\s*(?:count|pieces?|items?|pack)?$/i.test(value)) return `${parseInt(value, 10)} pack`;
  if (id === "batteryCapacity") {
    const capacity = value.match(/^([\d.]+)\s*(m?Ah)$/i);
    if (capacity) return `${Number(capacity[1]) * (/^Ah$/i.test(capacity[2]) ? 1000 : 1)} mAh`;
  }
  if (["memory", "storage"].includes(id)) {
    const capacity = value.match(/\b(\d+(?:\.\d+)?)\s*(GB|TB)\b/i);
    if (capacity) {
      const amount = Number(capacity[1]), unit = capacity[2].toUpperCase();
      if (id === "memory" && (unit !== "GB" || amount > 512)) return "";
      return `${amount} ${unit}`;
    }
  }
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
    const sourceName = rawName.replace(/\((inches|in|mm\.?|cm|kg|lbs?\.?|Hz|ms|watts)\)$/i, "").replace(/^monitor\s+/i, "").trim();
    const name = englishLabel(sourceName) || specificationText(sourceName) || sourceName;
    // Business contact/schedule rows belong to the retailer, not its products.
    // Match their values too, so a real property such as phone compatibility
    // remains available and does not become a category-specific exception.
    if (businessMetadata.test(name) && /(?:\+?\d[\d\s()-]{7,}|\b\d{1,2}:\d{2}\b|\S+@\S+\.\S+)/.test(valueText(pair.value))) continue;
    if (!name || name.length > 64 || /\uFFFD/.test(name) || nonSpecification.test(name) || retailerDetails.test(name) || /^(?:parameter|specification|פרמטר|דגם|מספר ספק|קישור ליצרן|זמן אספקה|תנאי תשלום|יתרון|תועלת)$/i.test(name)) continue;
    const alias = aliases.find(([, , match]) => match.test(name) || match.test(sourceName));
    const label = alias?.[1] ?? (englishLabel(name) || specificationText(name));
    if (!label) continue;
    const id = alias?.[0] ?? `spec:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_")}`;
    const values = [pair.value].flat().flatMap(raw => {
      const text = valueText(raw);
      const parts = ["ports", "connectivity", "adaptiveSync", "standAdjustments", "features", "material", "color", "capacity"].includes(id) ? text.split(/,\s+|[;|]|\s+(?:and|&|\/)\s+|\s*\+\s*/i) : [raw];
      return parts.map(part => normalizedValue(id, part, pair.unit || (/^\d+(?:\.\d+)?$/.test(valueText(part)) ? unit : "")));
    }).map(specificationText).filter(value => value && value.length <= 100 && !/https?:|www\.|out of stock|in stock/i.test(value));
    if (!values.length) continue;
    const basePorts = id === "ports" ? values.flatMap(value => value.match(/HDMI|DisplayPort|USB-C|Thunderbolt|DVI|VGA/gi) ?? []) : [];
    attributes[id] = [...new Set([...[attributes[id] ?? []].flat(), ...values, ...basePorts])];
    labels[id] = label.charAt(0).toUpperCase() + label.slice(1);
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
  const dom = load(html);
  dom("script,style,nav,header,footer,address,[role='navigation'],[role='contentinfo'],.contact-info,.contact-details,.opening-hours,.business-hours,.related-products,.recommendations").remove();
  const stripped = dom.html();
  for (const table of stripped.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rawRows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => cell[1]));
    const rows = rawRows.map(cells => cells.map(cleanText));
    const firstRow = table[1].match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i)?.[1] || "";
    const allHeaders = [...firstRow.matchAll(/<th\b/gi)].length === rows[0]?.length;
    const cellValue = (name, source) => {
      const id = aliases.find(([, , match]) => match.test(name))?.[0];
      return cleanText(["material", "color", "features", "ports", "connectivity"].includes(id)
        ? source.replace(/<\/p>\s*<p\b[^>]*>|<br\s*\/?\s*>/gi, "; ") : source);
    };
    // Benefit/comparison tables describe marketing claims, not named specifications.
    if (rows[0]?.some(cell => /^(benefit|advantage|why it matters|יתרון|תועלת|למה זה חשוב)$/i.test(cell))) continue;
    // Some shops transpose a specification table: property names in the first
    // row, this product's values in the second. Multiple value rows are a
    // comparison/variant table and cannot be assigned to the current product.
    if (rows.length === 2 && rows[0].length >= 2 && rows[1].length === rows[0].length
      && !/\b(?:colspan|rowspan)\s*=/i.test(table[1])
      && rows[0].every(name => name && name.length <= 64)
      && (rows[0].length > 2 && /<th\b/i.test(table[1]) || rows[0].filter(name => aliases.some(([, , match]) => match.test(name))).length >= 2)) {
      rows[0].forEach((name, index) => { if (rows[1][index]) pairs.push({ name, value: cellValue(name, rawRows[1][index]) }); });
      continue;
    }
    rows.forEach((cells, index) => {
      const heading = index === 0 && allHeaders && /^(?:property|attribute(?: name)?|specification|parameter|feature|name|מאפיין|תכונה|פרמטר)$/i.test(cells[0])
        && /^(?:value|values|details|description|specifications?|ערך|נתון)$/i.test(cells[1]);
      if (cells.length === 2 && !heading) pairs.push({ name: cells[0], value: cellValue(cells[0], rawRows[index][1]) });
    });
  }
  for (const row of stripped.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) pairs.push({ name: cleanText(row[1]), value: cleanText(row[2]) });
  for (const row of (stripped + " " + (product.description ?? "")).matchAll(/<(?:li|p)\b[^>]*>([\s\S]*?)<\/(?:li|p)>/gi)) {
    const match = cleanText(row[1]).match(/^([^:]{2,48}):\s*(.{1,100})$/);
    if (match) pairs.push({ name: match[1], value: match[2] });
  }
  return pairs;
}

// A subsection remains part of its contact/recommendation section until a
// heading at the same or a higher level starts the next section. Apply this
// boundary to prose too, otherwise unrelated colors/power leak into facets.
export function productMarkdownText(content) {
  let excludedDepth = 0;
  return String(content ?? "").split(/\r?\n/).filter(line => {
    const heading = line.trim().match(/^(#{1,6})\s/);
    if (heading) {
      const depth = heading[1].length;
      if (excludedDepth && depth > excludedDepth) return false;
      excludedDepth = /related products|you may also|recommendations|\bcontact\b|opening hours|מוצרים נוספים|מוצרים דומים|צור קשר|שעות פתיחה/i.test(line) ? depth : 0;
    }
    return !excludedDepth;
  }).join("\n");
}

// Content workflows return Markdown rather than HTML. Keep named source rows
// structured, including properties unknown to the predefined alias list.
export function extractMarkdownSpecifications(content) {
  const pairs = [], lines = productMarkdownText(content).split(/\r?\n/);
  const text = value => cleanText(value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""));
  const cells = line => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^#{1,6}\s/.test(line)) continue;
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
      const names = cells(line), rows = [];
      index += 2;
      for (; index < lines.length && lines[index].includes("|"); index++) rows.push(cells(lines[index]));
      index--;
      const transposed = rows.length === 1 && rows[0].length === names.length && names.length >= 2
        && (names.length > 2 || names.every(name => aliases.some(([, , match]) => match.test(name))));
      if (transposed) {
        names.forEach((name, i) => { if (name && rows[0][i]) pairs.push({ name, value: rows[0][i] }); });
      } else if (names.length === 2 && !/benefit|advantage|why it matters/i.test(names.join(" "))) {
        for (const row of rows) if (row.length === 2 && row[0] && row[1]) pairs.push({ name: row[0], value: row[1] });
      }
      continue;
    }
    const match = text(line.replace(/^[-+*]\s*/, "")).match(/^([^:：]{2,48})[:：]\s*(.{1,100})$/);
    if (match) pairs.push({ name: match[1], value: match[2] });
  }
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

export function proseAttributes(text) {
  const pairs = [], add = (name, value) => { if (value) pairs.push({ name, value }); };
  add("Voltage", [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*V\b/gi)].map(match => `${match[1]} V`));
  add("Battery capacity", [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(mAh|Ah)\b/gi)].map(match => `${match[1]} ${match[2]}`));
  if (/\bbatter(?:y|ies)\b/i.test(text)) {
    add("Product type", "Battery");
    if (/\brechargeable\b/i.test(text) && !/non[- ]rechargeable/i.test(text)) add("Battery type", "Rechargeable");
  }
  for (const [name, regex] of [
    ["Capacity", /\b(\d+(?:[-–]\d+)?)\s*(?:people|persons?|person|man)\b/i],
    ["Power", /(?<![\d.])(\d{1,5}(?:\.\d+)?)\s*(?:W|watts?)\b/i],
    ["Weight", /\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i],
    ["Battery life", /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:battery|runtime|of use)/i],
  ]) { const match = text.match(regex); if (match) add(name, match[1] + ({ Capacity: " people", Power: " W", Weight: " kg", "Battery life": " hours" }[name])); }
  for (const name of ["Width", "Height", "Depth", "Length"]) {
    const match = text.match(new RegExp("\\b" + name + "\\s*[:=-]?\\s*(\\d+(?:\\.\\d+)?\\s*(?:cm|mm|in|m))\\b", "i"));
    add(name, match?.[1]);
  }
  add("Dimensions", text.match(/\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|in)\b/i)?.[0]);
  for (const [name, yes, no] of [
    ["Chairs included", /(?:includes?|with)\s+(?:\d+\s+)?chairs|כולל.{0,8}כיסאות/i, /(?:without|no)\s+chairs|ללא כיסאות|לא כולל כיסאות/i],
    ["Extendable", /\bextendable|\bextending\b|נפתח(?:ת)?/i, /\bnon[- ]extendable|does not extend|לא נפתח/i],
  ]) add(name, no.test(text) ? "No" : yes.test(text) ? "Yes" : "");
  return structuredAttributes(pairs);
}
