import { withSupabase } from "npm:@supabase/server@1.4.1";
import { optionalUserId } from "../_shared/auth.ts";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson, requireUuid } from "../_shared/http.ts";

type AnalyticsRequest = {
  eventName?: unknown;
  anonymousId?: unknown;
  pagePath?: unknown;
  properties?: unknown;
};

const sensitivePropertyKey = /authorization|code|cookie|invite|offer|quote|secret|token/iu;
const sensitiveQueryParameter = /[?&][^=&#\s]*(?:authorization|code|cookie|invite|offer|quote|secret|token)[^=&#\s]*=[^&#\s]*/giu;
const allowedEvents = new Set([
  "page_view",
  "course_view",
  "cta_private_workshop",
  "cta_workshops",
  "cta_private_request",
  "cta_workshop_detail",
  "waitlist_started",
  "checkout_confirmed",
  "private_quote_checkout_started",
  "waitlist_offer_checkout_started",
]);
const eventPropertyKeys: Record<string, ReadonlySet<string>> = {
  page_view: new Set(["utm_source", "utm_medium", "utm_campaign"]),
  course_view: new Set(["utm_source", "utm_medium", "utm_campaign", "course_slug"]),
  cta_private_workshop: new Set(["target_path"]),
  cta_workshops: new Set(["target_path"]),
  cta_private_request: new Set(["target_path"]),
  cta_workshop_detail: new Set(["target_path"]),
  waitlist_started: new Set(["workshop_slug"]),
  checkout_confirmed: new Set(),
  private_quote_checkout_started: new Set(),
  waitlist_offer_checkout_started: new Set(["workshop_slug"]),
};
const rateLimitWindowMs = 10 * 60 * 1_000;

function siteBase(): URL {
  return new URL(env("PUBLIC_SITE_URL"));
}

function sameOriginPathname(value: string, base: URL): string | null {
  try {
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return null;
    return parsed.pathname.slice(0, 500);
  } catch {
    return null;
  }
}

function sanitizeAnalyticsProperties(
  eventName: string,
  value: unknown,
  base: URL,
): Record<string, string> {
  const input = (value ?? {}) as Record<string, unknown>;
  const allowed = eventPropertyKeys[eventName];
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!allowed?.has(key) || sensitivePropertyKey.test(key) || typeof entry !== "string") {
      throw new ApiError("invalid_properties", "properties contains an unsupported value.");
    }
    if (key === "target_path") {
      const pathname = sameOriginPathname(entry, base);
      if (pathname === null) {
        throw new ApiError("invalid_properties", "target_path must be a same-origin path.");
      }
      output[key] = pathname;
      continue;
    }
    if (key === "course_slug" || key === "workshop_slug") {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry) || entry.length > 120) {
        throw new ApiError("invalid_properties", `${key} is invalid.`);
      }
      output[key] = entry;
      continue;
    }
    const label = entry.replace(sensitiveQueryParameter, "").trim().slice(0, 200);
    if (!label || /@|https?:\/\//iu.test(label)) {
      throw new ApiError("invalid_properties", `${key} is invalid.`);
    }
    output[key] = label;
  }
  return output;
}

function requestAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address = req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "address-unavailable";
  return address.slice(0, 256);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await readJson<AnalyticsRequest>(req, 12_288);
      if (typeof body.eventName !== "string" || !allowedEvents.has(body.eventName)) {
        throw new ApiError("invalid_event_name", "eventName is invalid.");
      }
      if (typeof body.pagePath !== "string" || !body.pagePath.startsWith("/") || body.pagePath.length > 2_000) {
        throw new ApiError("invalid_page_path", "pagePath must be a local path.");
      }
      if (body.properties !== undefined && (typeof body.properties !== "object" || body.properties === null || Array.isArray(body.properties))) {
        throw new ApiError("invalid_properties", "properties must be an object.");
      }

      const base = siteBase();
      const pagePath = sameOriginPathname(body.pagePath, base);
      if (pagePath === null) {
        throw new ApiError("invalid_page_path", "pagePath must be a same-origin local path.");
      }
      const properties = sanitizeAnalyticsProperties(body.eventName, body.properties, base);
      const referrer = req.headers.get("referer");
      const referrerPath = referrer ? sameOriginPathname(referrer, base) : null;
      const anonymousId = body.anonymousId === null || body.anonymousId === undefined
        ? null
        : requireUuid(body.anonymousId, "anonymousId");
      const userId = await optionalUserId(req, ctx.supabaseAdmin);
      const rateWindow = Math.floor(Date.now() / rateLimitWindowMs);
      const abuseHash = await hmacSha256Hex(
        env("RATE_LIMIT_HASH_SALT"),
        `clearstep-analytics-rate-limit|${rateWindow}|${requestAddress(req)}`,
      );
      const result = await rpc(ctx.supabaseAdmin, "ingest_analytics_event", {
        p_event_name: body.eventName,
        p_anonymous_id: anonymousId,
        p_user_id: userId,
        p_abuse_hash: abuseHash,
        p_page_path: pagePath,
        p_referrer: referrerPath,
        p_utm_source: typeof properties.utm_source === "string" ? properties.utm_source : null,
        p_utm_medium: typeof properties.utm_medium === "string" ? properties.utm_medium : null,
        p_utm_campaign: typeof properties.utm_campaign === "string" ? properties.utm_campaign : null,
        p_properties: properties,
        p_occurred_at: new Date().toISOString(),
      });
      return ok(result, 202);
    } catch (error) {
      return handleError(error);
    }
  }),
};
