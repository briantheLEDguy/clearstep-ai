/** Serialize JSON for an inline application/ld+json script without allowing HTML breakout. */
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}
