const translations = [
  [/סוללות|סוללה/gu, "battery"], [/נטענות|נטענים|נטענת|נטען/gu, "rechargeable"],
  [/אוזניות/gu, "headphones"], [/אלחוטיות|אלחוטיים|אלחוטי/gu, "wireless"], [/חוטיות|חוטיים|חוטי/gu, "wired"],
  [/מחשבים ניידים|מחשב נייד/gu, "laptop"], [/תחנות עגינה|תחנת עגינה/gu, "dock"],
  [/מסך מחשב|מסכים|מסך/gu, "monitor"], [/דיגיטליות|דיגיטליים|דיגיטלי/gu, "digital"],
  [/שעון יד/gu, "wristwatch"], [/שעון חכם/gu, "smartwatch"], [/שעון קיר/gu, "wall clock"], [/שעון מעורר/gu, "alarm clock"], [/שעונים|שעון/gu, "clock"],
];
export function productWords(value) {
  let text = String(value ?? "").toLowerCase();
  for (const [pattern, word] of translations) text = text.replace(pattern, word);
  return text.replace(/\bbatteries\b/g, "battery").replace(/\bnotebooks?\b/g, "laptop").replace(/\bdocking station\b/g, "dock");
}
function normalized(value) { return productWords(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function models(value) {
  return (String(value).match(/\b[a-z\d]+(?:[-._/][a-z\d]+)*\b/gi) ?? [])
    .filter(word => /[a-z]/i.test(word) && /\d/.test(word) && !/^(?:\d+(?:gb|tb|mb|hz|mah|ms|mm|cm|w|v|k|p)|usb[-.]?\d.*|ddr\d|lpddr\d.*|wi-?fi\d*)$/i.test(word))
    .map(word => word.toLowerCase().replace(/[^a-z\d]/g, ""));
}
export function sameProductIdentity(title, evidence) {
  if (contradictsQuery(evidence, title)) return false;
  const wanted = models(title), found = models(evidence);
  if (wanted.length) return wanted.every(model => found.includes(model));
  const text = normalized(title), source = normalized(evidence);
  // Without an identifier require the complete title, never a few generic words.
  return text.length >= 8 && (` ${source} `).includes(` ${text} `);
}
export function contradictsQuery(title, query) {
  const actual = productWords(title), wanted = productWords(query);
  for (const [positive, negative] of [[/\bwireless\b/i, /\bwired\b/i], [/\brechargeable\b/i, /\bnon[- ]rechargeable\b|\bdisposable\b/i]]) {
    if (positive.test(wanted) && negative.test(actual)) return true;
  }
  // A feature/accessory in the tail of a title does not make it the main product.
  const head = actual.split(/\b(?:with|for|compatible with|including)\b|\s(?:עם|עבור|כולל)\s/i)[0];
  const nouns = ["battery", "headphones", "laptop", "monitor", "clock", "dock", "camera", "printer", "tent", "charger"];
  const noun = nouns.find(word => new RegExp(`\\b${word}s?\\b`, "i").test(wanted));
  if (noun && head !== actual && !new RegExp(`\\b${noun}s?\\b`, "i").test(head)) return true;
  const capacities = [...wanted.matchAll(/\b(\d+)\s*(gb|tb)\b/gi)];
  if (capacities.length === 1 && /\b(?:gb|tb)\b|\d(?:gb|tb)\b/i.test(actual)) {
    const token = capacities[0];
    if (!new RegExp(`\\b${token[1]}\\s*${token[2]}\\b`, "i").test(actual)) return true;
  }
  return false;
}
