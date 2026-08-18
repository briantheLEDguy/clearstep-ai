import Stripe from "npm:stripe@22.3.2";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson } from "../_shared/http.ts";
import { validateWorkshopPrice } from "../_shared/stripe.ts";

type AdminRequest = {
  action?: unknown;
  payload?: unknown;
};

const actions = new Set([
  "catalog_list",
  "course_upsert",
  "session_upsert",
  "private_requests_list",
  "private_request_update",
  "quote_create",
  "quote_send",
  "analytics_summary",
  "enrollments_list",
  "google_connection_status",
  "staff_context",
  "staff_list",
  "staff_invites_list",
  "staff_invite_revoke",
  "staff_update",
  "waitlist_list",
  "waitlist_offer",
  "waitlist_remove",
  "operations_status",
  "automation_jobs_list",
  "automation_job_retry",
  "email_delivery_reconcile",
  "audit_list",
]);

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

function validateCourseContent(payload: Record<string, unknown>) {
  const textFields: Array<[string, number]> = [
    ["slug", 120],
    ["title", 240],
    ["summary", 1_000],
    ["description", 10_000],
    ["level", 120],
    ["audience", 2_000],
  ];
  for (const [field, maximum] of textFields) {
    if (!boundedText(payload[field], maximum)) {
      throw new ApiError("invalid_course_content", `${field} is required and must be ${maximum} characters or fewer.`);
    }
  }

  if (
    !Array.isArray(payload.outcomes)
    || payload.outcomes.length < 1
    || payload.outcomes.length > 20
    || payload.outcomes.some((value) => !boundedText(value, 500))
  ) {
    throw new ApiError("invalid_course_content", "Provide 1–20 outcomes of 500 characters or fewer.");
  }

  if (
    !Array.isArray(payload.agenda)
    || payload.agenda.length < 1
    || payload.agenda.length > 20
    || payload.agenda.some((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
      const item = value as Record<string, unknown>;
      return !boundedText(item.title, 120) || !boundedText(item.detail, 500);
    })
  ) {
    throw new ApiError("invalid_course_content", "Provide 1–20 agenda steps with a short title and detail.");
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<AdminRequest>(req, 65_536);
      if (typeof body.action !== "string" || !actions.has(body.action)) {
        throw new ApiError("unsupported_admin_action", "That administration action is not supported.");
      }
      if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
        throw new ApiError("invalid_request", "payload must be an object.");
      }
      let payload = (body.payload ?? {}) as Record<string, unknown>;

      if (body.action === "course_upsert" || body.action === "quote_create") {
        if (body.action === "course_upsert") validateCourseContent(payload);
        const role = await rpc<string | null>(ctx.supabaseAdmin, "get_staff_role", {
          p_user_id: user.id,
        });
        if (role !== "owner" && role !== "admin") {
          throw new ApiError("staff_admin_required", "Administrator access is required.", 403);
        }

        const priceId = typeof payload.stripe_price_id === "string"
          ? payload.stripe_price_id.trim()
          : "";
        const productId = typeof payload.stripe_product_id === "string"
          ? payload.stripe_product_id.trim()
          : "";
        if (Boolean(priceId) !== Boolean(productId)) {
          throw new ApiError(
            "stripe_price_pair_required",
            "Stripe Product and Price IDs must be configured together.",
          );
        }
        if (body.action === "quote_create" && (!priceId || !productId)) {
          throw new ApiError(
            "stripe_price_pair_required",
            "A private quote requires a dedicated Stripe Product and Price.",
          );
        }
        if (priceId && productId) {
          const amountCents = Number(
            body.action === "quote_create" ? payload.amount_cents : payload.price_cents,
          );
          if (!Number.isInteger(amountCents) || amountCents <= 0) {
            throw new ApiError("invalid_request", "price_cents must be a positive whole number.");
          }
          const stripe = new Stripe(env("STRIPE_API_KEY"), {
            apiVersion: "2026-06-24.dahlia",
          });
          await validateWorkshopPrice(stripe, {
            priceId,
            productId,
            amountCents,
            currency: "EUR",
          });
          payload = {
            ...payload,
            stripe_price_id: priceId,
            stripe_product_id: productId,
            price_cents: amountCents,
            amount_cents: amountCents,
          };
        }
      }

      if (body.action === "quote_send") {
        payload = {
          ...payload,
          payment_url_base: `${env("PUBLIC_SITE_URL").replace(/\/$/u, "")}/account/private-quote`,
        };
      }

      if (body.action === "automation_jobs_list") {
        const result = await rpc(ctx.supabaseAdmin, "list_automation_jobs_with_delivery_state", {
          p_actor_user_id: user.id,
          p_limit: 300,
        });
        return ok(result);
      }

      if (body.action === "automation_job_retry") {
        if (typeof payload.job_id !== "string") {
          throw new ApiError("invalid_request", "job_id is required.");
        }
        const result = await rpc(ctx.supabaseAdmin, "retry_non_email_automation_job", {
          p_actor_user_id: user.id,
          p_job_id: payload.job_id,
        });
        return ok(result);
      }

      if (body.action === "email_delivery_reconcile") {
        if (
          typeof payload.job_id !== "string" ||
          (payload.resolution !== "confirm_sent" && payload.resolution !== "retry_unsent")
        ) {
          throw new ApiError(
            "invalid_request",
            "job_id and a valid email reconciliation resolution are required.",
          );
        }
        const result = await rpc(ctx.supabaseAdmin, "reconcile_email_delivery", {
          p_actor_user_id: user.id,
          p_job_id: payload.job_id,
          p_resolution: payload.resolution,
        });
        return ok(result);
      }

      const result = await rpc(ctx.supabaseAdmin, "staff_admin_action", {
        p_actor_user_id: user.id,
        p_action: body.action,
        p_payload: payload,
      });
      return ok(result);
    } catch (error) {
      return handleError(error);
    }
  }),
};
