const groups: Array<{ match: RegExp; suggestions: string[] }> = [
  { match: /phone|smartphone|iphone|galaxy/i, suggestions: ["protective phone case", "screen protector", "USB-C fast charger", "wireless charging stand", "phone power bank", "car phone mount", "USB-C cable", "Bluetooth earbuds"] },
  { match: /laptop|notebook|macbook|chromebook/i, suggestions: ["laptop sleeve", "wireless mouse", "USB-C dock", "laptop stand", "external monitor", "portable SSD", "webcam", "compact keyboard"] },
  { match: /dining\s+(?:table|set)|table/i, suggestions: ["dining chairs", "table protector", "pendant light", "table runner", "dining bench", "placemat set", "chair cushions", "serving cart"] },
  { match: /clock|watch/i, suggestions: ["rechargeable batteries", "picture hanging hooks", "bedside lamp", "clock repair kit", "wall shelf", "smart light bulb", "nightstand", "cable organizer"] },
  { match: /shoes?|sneakers?|boots?/i, suggestions: ["performance socks", "shoe insoles", "shoe care kit", "shoe storage rack", "waterproofing spray", "heel cushions", "shoe trees", "replacement laces"] },
  { match: /coffee|espresso/i, suggestions: ["coffee grinder", "coffee filters", "fresh coffee beans", "milk frother", "espresso cups", "coffee scale", "knock box", "water filter"] },
  { match: /camera|lens/i, suggestions: ["camera bag", "camera tripod", "memory card", "spare camera battery", "lens cleaning kit", "camera strap", "card reader", "portable light"] },
  { match: /(?:television|\btv\b|monitor)/i, suggestions: ["soundbar", "TV wall mount", "HDMI cable", "streaming device", "surge protector", "universal remote", "cable cover", "media console"] },
  { match: /vacuum/i, suggestions: ["vacuum filters", "replacement brush roll", "storage rack", "vacuum bags", "crevice tool", "floor cleaning solution", "extension hose", "pet hair attachment"] },
  { match: /printer/i, suggestions: ["printer ink", "printer paper", "USB printer cable", "photo paper", "label sheets", "printer stand", "surge protector", "document shredder"] },
  { match: /bike|bicycle/i, suggestions: ["bike helmet", "bike lock", "bike lights", "floor pump", "repair kit", "water bottle cage", "phone mount", "bike rack"] },
  { match: /drill|saw|tool/i, suggestions: ["drill bit set", "safety glasses", "tool organizer", "spare tool battery", "work gloves", "screwdriver bit set", "measuring tape", "extension cord"] },
  { match: /(?:power supply|\bpsu\b)/i, suggestions: ["PC power cable", "surge protector", "modular PSU cables", "PC case", "motherboard", "graphics card", "cable ties", "power supply tester"] },
];

export function recommendationsFor(recent: string[]): string[] {
  const output: string[] = [];
  const used = new Set(recent.map((item) => item.toLowerCase()));
  const matchedGroups: Array<{ match: RegExp; suggestions: string[] }> = [];
  for (const search of recent) {
    const group = groups.find(({ match }) => match.test(search));
    if (group && !matchedGroups.includes(group)) matchedGroups.push(group);
  }
  for (let index = 0; output.length < 3 && index < 8; index++) {
    for (const group of matchedGroups) {
      const suggestion = group.suggestions[index];
      if (suggestion && !used.has(suggestion.toLowerCase()) && !output.some((item) => item.toLowerCase() === suggestion.toLowerCase())) output.push(suggestion);
      if (output.length === 3) break;
    }
  }
  if (output.length < 3 && recent[0]) {
    const base = recent[0].replace(/\s+(?:accessories|replacement parts|care kit|storage solution|cleaning supplies|travel case|protective cover|maintenance kit)$/i, "").trim();
    for (const suffix of ["accessories", "replacement parts", "care kit", "storage solution", "cleaning supplies", "travel case", "protective cover", "maintenance kit"]) {
      const suggestion = `${base} ${suffix}`;
      if (!used.has(suggestion.toLowerCase()) && !output.some((item) => item.toLowerCase() === suggestion.toLowerCase())) output.push(suggestion);
    }
  }
  return output.slice(0, 3);
}
