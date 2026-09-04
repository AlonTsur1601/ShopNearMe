const groups: Array<{ match: RegExp; suggestions: string[] }> = [
  { match: /phone|smartphone|iphone|galaxy/i, suggestions: ["protective phone case", "screen protector", "USB-C fast charger"] },
  { match: /laptop|notebook|macbook|chromebook/i, suggestions: ["laptop sleeve", "wireless mouse", "USB-C dock"] },
  { match: /dining\s+(?:table|set)|table/i, suggestions: ["dining chairs", "table protector", "pendant light"] },
  { match: /clock|watch/i, suggestions: ["rechargeable batteries", "picture hanging hooks", "bedside lamp"] },
  { match: /shoes?|sneakers?|boots?/i, suggestions: ["performance socks", "shoe insoles", "shoe care kit"] },
  { match: /coffee|espresso/i, suggestions: ["coffee grinder", "coffee filters", "fresh coffee beans"] },
  { match: /camera|lens/i, suggestions: ["camera bag", "camera tripod", "memory card"] },
  { match: /(?:television|\btv\b|monitor)/i, suggestions: ["soundbar", "TV wall mount", "HDMI cable"] },
  { match: /vacuum/i, suggestions: ["vacuum filters", "replacement brush roll", "storage rack"] },
  { match: /printer/i, suggestions: ["printer ink", "printer paper", "USB printer cable"] },
  { match: /bike|bicycle/i, suggestions: ["bike helmet", "bike lock", "bike lights"] },
  { match: /drill|saw|tool/i, suggestions: ["drill bit set", "safety glasses", "tool organizer"] },
];

export function recommendationsFor(recent: string[]): string[] {
  const output: string[] = [];
  for (const search of recent) {
    const group = groups.find(({ match }) => match.test(search));
    for (const suggestion of group?.suggestions ?? []) if (!output.some((item) => item.toLowerCase() === suggestion.toLowerCase()) && !recent.some((item) => item.toLowerCase() === suggestion.toLowerCase())) output.push(suggestion);
  }
  return output.slice(0, 6);
}
