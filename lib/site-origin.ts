const fallbackOrigin = "https://clearstep-ai.openai.site";

export function getSiteOrigin() {
  const configuredOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? fallbackOrigin).replace(/\/$/u, "");
  try {
    const parsed = new URL(configuredOrigin);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol === "https:" || (isLocal && parsed.protocol === "http:")) {
      return parsed.origin;
    }
  } catch {
    // Fall through to the production-safe canonical origin.
  }
  return fallbackOrigin;
}
