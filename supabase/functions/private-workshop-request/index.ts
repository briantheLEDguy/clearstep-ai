import { withSupabase } from "npm:@supabase/server@1.4.1";
import { sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import {
  ApiError,
  asText,
  env,
  handleError,
  methodNotAllowed,
  normalizeEmail,
  ok,
  readJson,
} from "../_shared/http.ts";

type RequestBody = Record<string, unknown>;

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await readJson<RequestBody>(req);
      if (typeof body.website === "string" && body.website.trim()) {
        return ok({ received: true }, 201);
      }
      if (body.website !== undefined && typeof body.website !== "string") {
        throw new ApiError("invalid_request", "website must be text.");
      }

      const startedAt = typeof body.startedAt === "number" ? body.startedAt : Number.NaN;
      const elapsedMs = Date.now() - startedAt;
      if (!Number.isFinite(startedAt) || elapsedMs < 1_500 || elapsedMs > 24 * 60 * 60 * 1_000) {
        throw new ApiError(
          "invalid_submission_timing",
          "Please reload the form and try again.",
        );
      }

      const attendeeCount = body.attendeeCount === null || body.attendeeCount === undefined
        ? null
        : Number(body.attendeeCount);
      if (attendeeCount !== null && (!Number.isInteger(attendeeCount) || attendeeCount < 1 || attendeeCount > 10_000)) {
        throw new ApiError(
          "invalid_request",
          "attendeeCount must be a whole number between 1 and 10000.",
        );
      }
      const payload = {
        contact_name: asText(body.contactName, "contactName", { min: 2, max: 120 }),
        email: normalizeEmail(body.email),
        phone: asText(body.phone, "phone", { max: 50, optional: true }),
        organization: asText(body.organization, "organization", { min: 2, max: 200 }),
        attendee_count: attendeeCount,
        preferred_format: asText(body.preferredFormat, "preferredFormat", { max: 20, optional: true }),
        preferred_timing: asText(body.preferredTiming, "preferredTiming", { max: 500, optional: true }),
        goals: asText(body.goals, "goals", { min: 10, max: 5_000 }),
        notes: asText(body.notes, "notes", { max: 5_000, optional: true }),
        consent_to_contact: body.consentToContact === true,
      };
      const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const fingerprint = await sha256Hex(
        `${forwarded}|${req.headers.get("user-agent") ?? ""}|${env("RATE_LIMIT_HASH_SALT")}`,
      );
      const result = await rpc(ctx.supabaseAdmin, "submit_private_workshop_request", {
        p_payload: payload,
        p_request_fingerprint: fingerprint,
      });
      return ok(result, 201);
    } catch (error) {
      return handleError(error);
    }
  }),
};
