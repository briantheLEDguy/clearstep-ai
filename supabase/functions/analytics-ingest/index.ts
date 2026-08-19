import { withSupabase } from "npm:@supabase/server@1.4.1";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson, requireUuid } from "../_shared/http.ts";

type AnalyticsRequest = {
  action?: unknown;
  policyVersion?: unknown;
  consentId?: unknown;
  sessionId?: unknown;
  eventName?: unknown;
  courseSlug?: unknown;
  utmSource?: unknown;
};

const ANALYTICS_CONSENT_VERSION = "2026-08-19";
const allowedEvents = new Set(["page_view", "course_view"]);
const COURSE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTM_SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const rateLimitWindowMs = 10 * 60 * 1_000;

function requestAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address = req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || forwarded
    || "address-unavailable";
  return address.slice(0, 256);
}

async function abuseHash(req: Request, purpose: "grant" | "event") {
  const rateWindow = Math.floor(Date.now() / rateLimitWindowMs);
  return hmacSha256Hex(
    env("RATE_LIMIT_HASH_SALT"),
    `clearstep-consented-analytics-${purpose}|${rateWindow}|${requestAddress(req)}`,
  );
}

function optionalCourseSlug(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !COURSE_SLUG_PATTERN.test(value)) {
    throw new ApiError("invalid_course_slug", "courseSlug is invalid.");
  }
  return value;
}

function optionalUtmSource(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UTM_SOURCE_PATTERN.test(value)) {
    throw new ApiError("invalid_utm_source", "utmSource is invalid.");
  }
  return value;
}

export default {
  // `verify_jwt = false` delegates the public-key check to this wrapper.
  // Browser analytics neither reads nor forwards a signed-in user's JWT.
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    try {
      const body = await readJson<AnalyticsRequest>(req, 1_024);

      if (body.action === "grant") {
        if (body.policyVersion !== ANALYTICS_CONSENT_VERSION) {
          throw new ApiError("invalid_policy_version", "The analytics consent version is invalid.");
        }

        const result = await rpc<{ consent_id?: unknown; expires_at?: unknown }>(
          ctx.supabaseAdmin,
          "grant_analytics_consent",
          {
            p_policy_version: ANALYTICS_CONSENT_VERSION,
            p_abuse_hash: await abuseHash(req, "grant"),
          },
        );
        if (typeof result.consent_id !== "string" || typeof result.expires_at !== "string") {
          throw new ApiError("database_operation_failed", "The consent record could not be created.", 500);
        }
        return ok({ consentId: result.consent_id, expiresAt: result.expires_at }, 201);
      }

      if (body.action === "withdraw") {
        const consentId = requireUuid(body.consentId, "consentId");
        const result = await rpc(ctx.supabaseAdmin, "withdraw_analytics_consent", {
          p_consent_id: consentId,
        });
        return ok(result);
      }

      if (body.action === "event") {
        const consentId = requireUuid(body.consentId, "consentId");
        const sessionId = requireUuid(body.sessionId, "sessionId");
        if (typeof body.eventName !== "string" || !allowedEvents.has(body.eventName)) {
          throw new ApiError("invalid_event_name", "eventName is invalid.");
        }

        const courseSlug = optionalCourseSlug(body.courseSlug);
        if ((body.eventName === "course_view") !== (courseSlug !== null)) {
          throw new ApiError("invalid_course_slug", "courseSlug is required only for a course view.");
        }
        const utmSource = optionalUtmSource(body.utmSource);

        // Do not derive even a short-lived abuse key until the opaque consent ID
        // is active. This keeps pre-consent visits out of analytics processing.
        const active = await rpc<boolean>(ctx.supabaseAdmin, "analytics_consent_active", {
          p_consent_id: consentId,
        });
        if (active !== true) return ok({ accepted: false }, 202);

        const result = await rpc(ctx.supabaseAdmin, "ingest_analytics_event", {
          p_consent_id: consentId,
          p_anonymous_id: sessionId,
          p_event_name: body.eventName,
          p_course_slug: courseSlug,
          p_utm_source: utmSource,
          p_abuse_hash: await abuseHash(req, "event"),
          p_occurred_at: new Date().toISOString(),
        });
        return ok(result, 202);
      }

      throw new ApiError("invalid_action", "action must be grant, withdraw, or event.");
    } catch (error) {
      return handleError(error);
    }
  }),
};
