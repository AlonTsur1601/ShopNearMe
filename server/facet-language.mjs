// Fail-closed English display normalization; no translation-service requests.
const labels = {
  "מספר לנים":"Capacity", "עונות":"Number of seasons", "עם תיק נשיאה":"Carry bag included", "עם פרוזדור כניסה":"Vestibule",
  "מספר החדרים":"Number of rooms", "שימוש":"Intended use", "גובה במרכז":"Center height", "רוחב מסך":"Aspect ratio",
  "מידות עם סטנד":"Dimensions with stand", "צבעים":"Color depth", "מספר דלתות":"Number of doors", "סוג בד":"Fabric",
  "חומר מסגרת":"Frame material", "מהירות סחיטה":"Spin speed", "דירוג אנרגטי":"Energy rating", "קיבולת כביסה":"Wash capacity",
  "מגיע עם כיסאות":"Chairs included", "נפתח":"Extendable", "מספר מקומות ישיבה":"Seating capacity", "סוג סוללה":"Battery type",
  "קיבולת סוללה":"Battery capacity", "משך פעולה":"Battery life", "couleur":"Color", "matière":"Material", "matériau":"Material",
  "taille":"Size", "poids":"Weight", "hauteur":"Height", "largeur":"Width", "profondeur":"Depth", "capacité":"Capacity",
  "marque":"Manufacturer", "nombre de portes":"Number of doors",
};
const phrases = {
  "עץ מלא":"Solid wood", "עץ תעשייתי":"Engineered wood", "ללא מעמד":"Without stand", "עם מעמד":"With stand",
  "עם סטנד":"With stand", "ללא סטנד":"Without stand", "זכוכית מחוסמת":"Tempered glass", "פלדת אל חלד":"Stainless steel",
  "מסך מחשב":"Computer monitor", "גובה מתכוונן":"Height adjustable", "אלחוטי":"Wireless", "חוטי":"Wired",
  "כניסת אוזניות":"Headphone jack", "יציאת אוזניות":"Headphone jack", "כיסאות כלולים":"Includes chairs", "תיק נשיאה":"Carry bag",
  "sans fil":"Wireless", "acier inoxydable":"Stainless steel", "bois massif":"Solid wood",
};
const words = {
  "שחור":"Black", "לבן":"White", "כחול":"Blue", "אדום":"Red", "ירוק":"Green", "אפור":"Gray", "צהוב":"Yellow", "חום":"Brown",
  "כתום":"Orange", "ורוד":"Pink", "סגול":"Purple", "כסוף":"Silver", "זהב":"Gold", "בז":"Beige", "עץ":"Wood", "זכוכית":"Glass",
  "מתכת":"Metal", "פלסטיק":"Plastic", "ניילון":"Nylon", "פוליאסטר":"Polyester", "כותנה":"Cotton", "אלומיניום":"Aluminum",
  "פלדה":"Steel", "עור":"Leather", "שיש":"Marble", "כן":"Yes", "יש":"Yes", "קיים":"Yes", "ללא":"No", "אין":"No", "לא":"No",
  "שטוח":"Flat", "קעור":"Curved", "מבריק":"Glossy", "מט":"Matte", "חיצוני":"External", "פנימי":"Internal", "פיבוט":"Pivot",
  "סיבוב":"Swivel", "הטייה":"Tilt", "הטיה":"Tilt", "גובה":"Height", "רוחב":"Width", "עומק":"Depth", "אורך":"Length",
  "משקל":"Weight", "מעלות":"degrees", "עונות":"seasons", "אנשים":"people", "אדם":"person", "ליטר":"L", "סנטימטר":"cm",
  "מילימטר":"mm", "מטר":"m", "דלתות":"doors", "חדרים":"rooms", "קמפינג":"Camping", "מתקפל":"Foldable", "עגול":"Round",
  "מרובע":"Square", "מלבני":"Rectangular", "אליפטי":"Oval", "rouge":"Red", "noir":"Black", "noire":"Black", "blanc":"White",
  "blanche":"White", "bleu":"Blue", "bleue":"Blue", "vert":"Green", "verte":"Green", "gris":"Gray", "jaune":"Yellow",
  "oui":"Yes", "non":"No", "bois":"Wood", "verre":"Glass", "acier":"Steel", "plastique":"Plastic", "coton":"Cotton", "cuir":"Leather",
};
const vocabulary = new Set(("a an the and or of for to from with without in on at by per up under over more less than only not no yes true false includes included supported unsupported built integrated type item product manufacturer brand material materials color colour depth gamut size shape width height length diameter radius thickness diagonal surface finish coating matte glossy anti glare screen panel display resolution refresh rate response time monitor computer power supply consumption rated current voltage frequency battery life runtime capacity volume weight net packaged total dimensions stand adjustable adjustment adjustments tilt swivel pivot speakers speaker webcam microphone ports port connector connectors connection connectivity inputs input output outputs audio video headphone jack usb hdmi displayport thunderbolt dvi vga lightning bluetooth wi fi wireless wired nvidia amd freesync g sync compatible adaptive premium pro vesa mounting mount wall interface black white blue red green yellow orange purple pink gray grey silver gold beige brown natural solid engineered wood glass marble stone ceramic metal plastic leather steel aluminum aluminium cotton polyester nylon canvas silicone rubber paper wool fabric stainless tempered waterproof water resistant resistance rechargeable smart portable cancelling cancellation noise isolating transparency foldable folding energy efficient dishwasher safe machine washable silent fast charging remote control touchscreen touch flat curved external internal sealed new used refurbished certified pre owned open box parts working condition retailer online store shop official free shipping active passive small medium large compact standard xl xxl xxs xs regular slim relaxed fit oversized queen king twin full california firmness firm soft memory foam hybrid innerspring latex storage ram ssd hdd nvme sata pcie atx sfx tfx plus titanium platinum bronze modular fully semi non cable management efficiency form factor support pack pieces piece count clock wall alarm desk mantel movement quartz digital mechanical atomic coffee maker drip espresso pod single serve cold brew french press camera mirrorless dslr instant action film vacuum robot cordless upright canister handheld tool drill driver hammer impact rotary chuck motor brushless brushed bare laser inkjet thermal all one printing monochrome auto manual duplex wheel bike bicycle road mountain electric bmx running trail walking hiking basketball training activity unlocked dual sim network laptop keyboard mouse tenkeyless switch optical linear tactile clicky seating seats seat chairs chair table fixed extendable extending extension leaf telescopic aperture focal ratio magnification lens telescope hydrostatic head cadr airflow coverage filter filtration hepa carbon purifier spin speed washing wash drying programs program number doors door seasons season rooms room tent camping mountaineering backpacking insect repellent treated pole poles stakes outer inner stove snow skirt construction carry bag vestibule intended use center rating roof floor load max maximum min minimum operating temperature degrees typical peak watts kilograms grams inches millimeters centimeters liters person people china usa israel united states germany japan korea france origin suitable gaming srgb ntsc dci adobe rgb lcd led oled woled qd qled ips va tn qhd wqhd uhd fhd fullhd hdr displayhdr gtg ms hz khz mhz ghz gb tb mb mah ah wh w v a kg g lb lbs oz ml l m cm mm in rpm lm lux nits cd h s ipx overvoltage overcurrent protection circuits heel toe drop shoe shoes insulation fill recycled organic pressure bar psi flow extraction custom spec specification fixture maker outdoor indoor summer winter spring autumn four three two flex raw boost amount e eps pulp rohs eu low blue light hardware solution eye care adjust standby mode cord safety litres cu ft feet inch overall clip hook loop zip zipper universal mesh supplied uv cleaning suction rating environmental ergonomic standards packaged contrast brightness screen size response aperture heel toe drop spin hydrostatic waterproof fabric stove snow skirt insect treated doors seasons tent poles stakes air purifier tent telescope clothing shoes headphones").split(/\s+/));

export function englishLabel(value) {
  const label = String(value ?? "").trim();
  if (!/[\p{L}]/u.test(label)) return "";
  return labels[label.toLowerCase()] ?? englishText(label);
}
for (const word of "wattage source settings dpi sensor focus focal zoom stabilizer stabilization stabilisation megapixels fps aperture pixel pixels mode thread fire retardant ventilation bag included poles stakes jack stove skirt snow seams taped double single layer layers pu pvc pe tpu polyester polycotton oxford ripstop ultralight lightweight freestanding pop instant dome tunnel geodesic footprint flysheet rainfly fiberglass fibreglass dac denier index resistance windproof breathable fabric inner outer number rooms seasons oz person sleeping headroom vestibule entrances head space carry bag hood sleeves doors door printed plain mesh net insect protection coated construction ultraviolet".split(" ")) vocabulary.add(word);
export function englishText(value, properName = false) {
  let text = String(value ?? "").replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
  if (!text || /\uFFFD|Ã|Â|Ð|×[\u0080-\u00ff]|&(?:#\w+|\w+);/.test(text)) return "";
  for (const [source, target] of Object.entries(phrases)) text = text.replaceAll(source, target);
  text = text.replace(/[\p{L}]+/gu, word => words[word.toLowerCase()] ?? word);
  if (/[^\x20-\x7e°²³µμ×–—−≤≥®™\s]/u.test(text)) return "";
  if (!properName && (text.match(/[a-z]+/gi) ?? []).some(word => !vocabulary.has(word.toLowerCase()) && !/^(?:[a-z]|mm|cm|kg|rgb|srgb|ntsc|ipx?|hbr|tmds)$/i.test(word))) return "";
  return text.replace(/\s+/g, " ").trim();
}
export function translateTerms(value) {
  let text = String(value ?? "");
  for (const [source, target] of Object.entries(phrases)) text = text.replaceAll(source, target);
  return text.replace(/[\p{L}]+/gu, word => words[word.toLowerCase()] ?? word);
}
export function normalizeOfferFacets(offer) {
  const attributes = {}, attributeLabels = {};
  for (const [id, raw] of Object.entries(offer.attributes ?? {})) {
    const name = offer.attributeLabels?.[id];
    if (name) { const label = englishLabel(name); if (!label) continue; attributeLabels[id] = label; }
    let values = [raw].flat().map(value => englishText(value, id === "retailer" || id === "brand")).filter(Boolean);
    if (id === "retailer" && !values.length) {
      try { values = [new URL(offer.destinationUrl).hostname.replace(/^www\./, "")]; } catch { /* no safe merchant label */ }
    }
    if (values.length) attributes[id] = Array.isArray(raw) ? [...new Set(values)] : values[0];
  }
  return { ...offer, attributes, attributeLabels };
}
