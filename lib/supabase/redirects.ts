export function safeReturnPath(value: string | null | undefined, fallback = "/account") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const parsed = new URL(value, "https://clearstep.local");
    if (parsed.origin !== "https://clearstep.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function callbackUrl(nextPath: string) {
  if (typeof window === "undefined") return "";
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", safeReturnPath(nextPath));
  return callback.toString();
}

