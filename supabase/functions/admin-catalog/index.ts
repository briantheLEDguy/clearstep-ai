import Stripe from "npm:stripe@22.3.2";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson, requireUuid } from "../_shared/http.ts";
import { validateWorkshopPrice } from "../_shared/stripe.ts";

type AdminRequest = {
  action?: unknown;
  payload?: unknown;
};

const actions = new Set([
  "catalog_list",
  "course_upsert",
  "course_price_update",
  "session_upsert",
  "private_requests_list",
  "private_request_update",
  "private_request_quotes_page",
  "quote_create",
  "quote_send",
  "dashboard_overview",
  "staff_list_page",
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
  "automation_job_cancel",
  "automation_job_rerun",
  "email_delivery_reconcile",
  "customer_requests_list",
  "customer_request_update",
  "retention_review_status",
  "audit_list",
]);

type CoursePricingContext = {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
};

const pagedResources = new Set([
  "enrollments",
  "waitlist",
  "private_requests",
  "customer_requests",
  "audit",
  "automation",
]);

function staffPagePayload(payload: Record<string, unknown>) {
  const resource = typeof payload.resource === "string" ? payload.resource : "";
  if (!pagedResources.has(resource)) {
    throw new ApiError("invalid_staff_page", "Choose a valid staff resource page.");
  }

  const limit = payload.limit === undefined ? 50 : Number(payload.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError("invalid_staff_page", "limit must be a whole number between 1 and 100.");
  }

  if (payload.cursor === undefined || payload.cursor === null) {
    return { resource, limit, cursorAt: null, cursorId: null };
  }
  if (typeof payload.cursor !== "object" || Array.isArray(payload.cursor)) {
    throw new ApiError("invalid_staff_page", "cursor must be an object.");
  }
  const cursor = payload.cursor as Record<string, unknown>;
  const cursorAt = typeof cursor.at === "string" ? cursor.at.trim() : "";
  if (!cursorAt || cursorAt.length > 64 || Number.isNaN(Date.parse(cursorAt))) {
    throw new ApiError("invalid_staff_page", "cursor.at must be a valid timestamp.");
  }
  const cursorId = typeof cursor.id === "string" ? cursor.id.trim() : "";
  if (resource === "audit") {
    if (!/^\d+$/u.test(cursorId)) {
      throw new ApiError("invalid_staff_page", "cursor.id must be an audit record identifier.");
    }
  } else {
    requireUuid(cursorId, "cursor.id");
  }
  return {
    resource,
    limit,
    cursorAt,
    cursorId,
  };
}

function privateRequestQuotesPagePayload(payload: Record<string, unknown>) {
  const requestId = requireUuid(payload.request_id, "request_id");
  const limit = payload.limit === undefined ? 20 : Number(payload.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError("invalid_private_request_quotes_page", "limit must be a whole number between 1 and 100.");
  }

  if (payload.cursor === undefined || payload.cursor === null) {
    return { requestId, limit, cursorAt: null, cursorId: null };
  }
  if (typeof payload.cursor !== "object" || Array.isArray(payload.cursor)) {
    throw new ApiError("invalid_private_request_quotes_page", "cursor must be an object.");
  }
  const cursor = payload.cursor as Record<string, unknown>;
  const cursorAt = typeof cursor.at === "string" ? cursor.at.trim() : "";
  if (!cursorAt || cursorAt.length > 64 || Number.isNaN(Date.parse(cursorAt))) {
    throw new ApiError("invalid_private_request_quotes_page", "cursor.at must be a valid timestamp.");
  }
  return {
    requestId,
    limit,
    cursorAt,
    cursorId: requireUuid(cursor.id, "cursor.id"),
  };
}

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

      if (body.action === "course_price_update") {
        const courseId = requireUuid(payload.course_id, "course_id");
        const priceCents = Number(payload.price_cents);
        if (!Number.isInteger(priceCents) || priceCents < 1) {
          throw new ApiError("course_price_invalid", "The course price must be a positive whole number of cents.");
        }

        const course = await rpc<CoursePricingContext>(ctx.supabaseAdmin, "get_course_pricing_for_update", {
          p_actor_user_id: user.id,
          p_course_id: courseId,
        });
        if (!course.stripe_product_id) {
          throw new ApiError(
            "course_stripe_product_required",
            "Connect a Stripe Product and Price before changing this course price.",
            409,
          );
        }
        if (course.price_cents === priceCents && course.stripe_price_id) {
          return ok({ course, unchanged: true });
        }

        const stripe = new Stripe(env("STRIPE_API_KEY"), {
          apiVersion: "2026-06-24.dahlia",
        });
        let stripePrice: Stripe.Price;
        try {
          stripePrice = await stripe.prices.create({
            active: true,
            currency: "eur",
            unit_amount: priceCents,
            product: course.stripe_product_id,
            tax_behavior: "inclusive",
            nickname: `${course.slug} · admin price`,
            metadata: {
              clearstep_course_id: course.id,
              clearstep_origin: "staff_workspace",
            },
          }, {
            idempotencyKey: `clearstep-course-price:${course.id}:${course.stripe_price_id ?? "none"}:${priceCents}`,
          });
        } catch {
          throw new ApiError(
            "stripe_price_create_failed",
            "Stripe could not create the replacement Price. Check the restricted key's Price permissions.",
            502,
          );
        }

        await validateWorkshopPrice(stripe, {
          priceId: stripePrice.id,
          productId: course.stripe_product_id,
          amountCents: priceCents,
          currency: "EUR",
        });

        const result = await rpc(ctx.supabaseAdmin, "update_course_price", {
          p_actor_user_id: user.id,
          p_course_id: course.id,
          p_price_cents: priceCents,
          p_stripe_price_id: stripePrice.id,
          p_expected_price_cents: course.price_cents,
          p_expected_stripe_price_id: course.stripe_price_id,
        });
        return ok(result);
      }

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

      if (body.action === "staff_list_page") {
        const page = staffPagePayload(payload);
        return ok(await rpc(ctx.supabaseAdmin, "list_staff_page", {
          p_actor_user_id: user.id,
          p_resource: page.resource,
          p_cursor_at: page.cursorAt,
          p_cursor_id: page.cursorId,
          p_limit: page.limit,
        }));
      }

      if (body.action === "private_request_quotes_page") {
        const page = privateRequestQuotesPagePayload(payload);
        return ok(await rpc(ctx.supabaseAdmin, "list_private_request_quotes_page", {
          p_actor_user_id: user.id,
          p_request_id: page.requestId,
          p_cursor_at: page.cursorAt,
          p_cursor_id: page.cursorId,
          p_limit: page.limit,
        }));
      }

      if (body.action === "dashboard_overview") {
        return ok(await rpc(ctx.supabaseAdmin, "dashboard_overview", {
          p_actor_user_id: user.id,
        }));
      }

      if (body.action === "customer_requests_list") {
        return ok(await rpc(ctx.supabaseAdmin, "list_customer_requests_for_staff", {
          p_actor_user_id: user.id,
        }));
      }

      if (body.action === "customer_request_update") {
        const requestId = requireUuid(payload.request_id, "request_id");
        const status = typeof payload.status === "string" ? payload.status : "";
        if (![
          "submitted",
          "in_review",
          "awaiting_customer",
          "completed",
          "declined",
        ].includes(status)) {
          throw new ApiError("invalid_customer_request_update", "Choose a valid customer request status.");
        }
        const resolutionNote = payload.resolution_note === undefined || payload.resolution_note === null || payload.resolution_note === ""
          ? null
          : typeof payload.resolution_note === "string" && payload.resolution_note.trim().length <= 1_000
            ? payload.resolution_note.trim()
            : (() => { throw new ApiError("invalid_customer_request_update", "resolution_note must be 1000 characters or fewer."); })();
        return ok(await rpc(ctx.supabaseAdmin, "update_customer_request", {
          p_actor_user_id: user.id,
          p_request_id: requestId,
          p_status: status,
          p_resolution_note: resolutionNote,
        }));
      }

      if (body.action === "retention_review_status") {
        return ok(await rpc(ctx.supabaseAdmin, "retention_review_status", {
          p_actor_user_id: user.id,
        }));
      }

      if (body.action === "automation_job_cancel") {
        const jobId = requireUuid(payload.job_id, "job_id");
        const result = await rpc(ctx.supabaseAdmin, "cancel_automation_job", {
          p_actor_user_id: user.id,
          p_job_id: jobId,
        });
        return ok(result);
      }

      if (body.action === "automation_job_rerun") {
        const jobId = requireUuid(payload.job_id, "job_id");
        const result = await rpc(ctx.supabaseAdmin, "rerun_non_email_automation_job", {
          p_actor_user_id: user.id,
          p_job_id: jobId,
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
