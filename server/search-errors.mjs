export function publicSearchError(error) {
  const code = error?.code || (error?.name === "TimeoutError" || error?.name === "AbortError" ? "search_timeout" : "search_unavailable");
  const messages = {
    source_blocked: "The search provider was blocked by Google (CAPTCHA). Results are incomplete.",
    quota_exhausted: "Search provider quota has been used up.",
    search_timeout: "The search time limit was reached. Results are incomplete.",
    search_unavailable: "Product search is temporarily unavailable.",
  };
  return { error: messages[code] || messages.search_unavailable, code, ...(error?.resetAt && !Number.isNaN(Date.parse(error.resetAt)) ? { resetAt: error.resetAt } : {}) };
}
