export type SupabasePublicConfig = {
  url: string;
  key: string;
};

/**
 * Public-only configuration used by browser code that must not initialise or
 * attach a Supabase Auth client, such as consented anonymous analytics.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key) return null;

  try {
    const parsed = new URL(url);
    const localHost = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) return null;
  } catch {
    return null;
  }

  return { url, key };
}
