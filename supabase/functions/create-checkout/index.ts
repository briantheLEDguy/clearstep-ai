import Stripe from "npm:stripe@22.3.2";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { CHECKOUT_LEGAL_DOCUMENT_KEYS, LEGAL_DOCUMENTS } from "../../../shared/legal-documents.ts";
import { requireUser } from "../_shared/auth.ts";
import { resolveWorkshopSession } from "../_shared/catalog.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson } from "../_shared/http.ts";
import { validateCatalogPrice } from "../_shared/stripe.ts";

type CheckoutRequest = {
  targetType?: unknown;
  serviceLine?: unknown;
  offeringSlug?: unknown;
  workshopSlug?: unknown;
  sessionRef?: unknown;
  offerToken?: unknown;
  quoteToken?: unknown;
  legalAccepted?: unknown;
};

type PrivateQuote = {
  quote_id: string;
  session_id: string;
  workshop_slug: string;
  checkout_expires_at: string;
};

type WorkshopHold = {
  reused: boolean;
  checkout_id: string;
  checkout_status?: "creating" | "open" | "payment_pending";
  stripe_checkout_session_id: string | null;
  hold_id: string;
  hold_expires_at: string;
  checkout_expires_at: string;
  booking_deadline_at: string;
  stripe_price_id: string;
  session_id: string;
  start_at: string;
  course_id: string;
  stripe_product_id: string;
  amount_cents: number;
  currency: "EUR";
};

type ServiceAttempt = {
  reused: boolean;
  checkout_id: string;
  checkout_status?: "creating" | "open" | "payment_pending";
  checkout_kind: "service_order";
  stripe_checkout_session_id: string | null;
  hold_id: null;
  session_id: null;
  service_offering_id: string;
  service_line_id: "plate_and_post";
  service_line_slug: "plate-and-post";
  service_slug: string;
  service_title: string;
  fulfillment_method: "manual_scheduling";
  checkout_expires_at: string;
  stripe_price_id: string;
  stripe_product_id: string;
  amount_cents: number;
  currency: "EUR";
};

type PreparedCheckout = {
  kind: "workshop" | "service_order";
  reused: boolean;
  checkoutId: string;
  checkoutStatus: "creating" | "open" | "payment_pending";
  stripeCheckoutSessionId: string | null;
  checkoutExpiresAt: string;
  checkoutDeadlineMs: number;
  stripePriceId: string;
  stripeProductId: string;
  amountCents: number;
  currency: "EUR";
  targetSlug: string;
  metadata: Record<string, string>;
};

type FailedAttempt = {
  released: boolean;
  checkout_status: string | null;
  stripe_checkout_session_id: string | null;
};

const stripe = new Stripe(env("STRIPE_API_KEY"), {
  apiVersion: "2026-06-24.dahlia",
});
const stripeMinimumWindowMs = 30 * 60 * 1_000;
const checkoutCreationCushionMs = 60 * 1_000;
const legacyTargetTypeDeadlineMs = Date.parse("2026-09-18T23:59:59Z");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    let workshopHold: WorkshopHold | null = null;
    let serviceAttempt: ServiceAttempt | null = null;
    let prepared: PreparedCheckout | null = null;
    let stripeSession: Stripe.Checkout.Session | null = null;
    let privateQuote: PrivateQuote | null = null;
    let quoteToken: string | null = null;

    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<CheckoutRequest>(req);
      if (body.legalAccepted !== true) {
        throw new ApiError(
          "legal_acknowledgement_required",
          "Please accept the Terms of service and Cancellation policy before continuing to checkout.",
          422,
        );
      }

      // Legacy workshop and private-quote clients may omit targetType only
      // during the migration window. Service checkout is never inferred.
      const targetTypeWasOmitted = body.targetType === undefined;
      if (targetTypeWasOmitted && Date.now() > legacyTargetTypeDeadlineMs) {
        throw new ApiError("invalid_request", "targetType is required.");
      }
      const targetType = targetTypeWasOmitted
        ? (typeof body.quoteToken === "string" && body.quoteToken.trim()
          ? "private_quote"
          : "workshop")
        : body.targetType;
      if (
        targetType !== "workshop"
        && targetType !== "service"
        && targetType !== "private_quote"
      ) {
        throw new ApiError(
          "invalid_request",
          "targetType must be workshop, service, or private_quote.",
        );
      }

      let workshopSlug = "";
      let sessionId = "";
      let offerTokenHash: string | null = null;
      let offeringSlug = "";

      if (targetType === "service") {
        if (
          body.serviceLine !== "plate_and_post"
          || typeof body.offeringSlug !== "string"
          || !slugPattern.test(body.offeringSlug)
          || body.workshopSlug !== undefined
          || body.sessionRef !== undefined
          || body.offerToken !== undefined
          || body.quoteToken !== undefined
        ) {
          throw new ApiError("invalid_service_checkout", "Choose a valid Plate & Post offering.");
        }
        offeringSlug = body.offeringSlug;
      } else if (targetType === "private_quote") {
        if (
          typeof body.quoteToken !== "string"
          || !body.quoteToken.trim()
          || body.serviceLine !== undefined
          || body.offeringSlug !== undefined
          || body.workshopSlug !== undefined
          || body.sessionRef !== undefined
          || body.offerToken !== undefined
        ) {
          throw new ApiError("invalid_private_quote", "The private quote link is invalid.");
        }
        quoteToken = body.quoteToken.trim();
        if (!/^[0-9a-f]{64}$/u.test(quoteToken)) {
          throw new ApiError("invalid_private_quote", "The private quote link is invalid.");
        }
        privateQuote = await rpc<PrivateQuote>(ctx.supabaseAdmin, "resolve_private_quote_checkout", {
          p_token_hash: await sha256Hex(quoteToken),
          p_user_id: user.id,
          p_user_email: user.email,
        });
        if (
          new Date(privateQuote.checkout_expires_at).getTime()
            <= Date.now() + stripeMinimumWindowMs + checkoutCreationCushionMs
        ) {
          throw new ApiError(
            "private_quote_checkout_window_too_short",
            "This quote no longer has enough time to start a secure checkout.",
            409,
          );
        }
        sessionId = privateQuote.session_id;
        workshopSlug = privateQuote.workshop_slug;
      } else {
        if (
          body.serviceLine !== undefined
          || body.offeringSlug !== undefined
          || body.quoteToken !== undefined
        ) {
          throw new ApiError("invalid_request", "Workshop checkout contains unrelated fields.");
        }
        sessionId = await resolveWorkshopSession(
          ctx.supabaseAdmin,
          body.workshopSlug,
          body.sessionRef,
        );
        workshopSlug = String(body.workshopSlug);
        offerTokenHash = typeof body.offerToken === "string" && body.offerToken
          ? await sha256Hex(body.offerToken)
          : null;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (targetType === "service") {
          serviceAttempt = await rpc<ServiceAttempt>(
            ctx.supabaseAdmin,
            "create_service_checkout_attempt",
            {
              p_service_slug: offeringSlug,
              p_user_id: user.id,
              p_email: user.email,
            },
          );
          prepared = {
            kind: "service_order",
            reused: serviceAttempt.reused,
            checkoutId: serviceAttempt.checkout_id,
            checkoutStatus: serviceAttempt.checkout_status ?? "creating",
            stripeCheckoutSessionId: serviceAttempt.stripe_checkout_session_id,
            checkoutExpiresAt: serviceAttempt.checkout_expires_at,
            checkoutDeadlineMs: new Date(serviceAttempt.checkout_expires_at).getTime(),
            stripePriceId: serviceAttempt.stripe_price_id,
            stripeProductId: serviceAttempt.stripe_product_id,
            amountCents: serviceAttempt.amount_cents,
            currency: serviceAttempt.currency,
            targetSlug: serviceAttempt.service_slug,
            metadata: {
              checkout_id: serviceAttempt.checkout_id,
              checkout_kind: "service_order",
              service_line_id: serviceAttempt.service_line_id,
              service_offering_id: serviceAttempt.service_offering_id,
            },
          };
        } else {
          workshopHold = privateQuote
            ? await rpc<WorkshopHold>(ctx.supabaseAdmin, "create_private_quote_checkout_hold", {
              p_quote_id: privateQuote.quote_id,
              p_quote_checkout_expires_at: privateQuote.checkout_expires_at,
              p_session_id: sessionId,
              p_user_id: user.id,
              p_email: user.email,
            })
            : await rpc<WorkshopHold>(ctx.supabaseAdmin, "create_checkout_hold", {
              p_session_id: sessionId,
              p_user_id: user.id,
              p_email: user.email,
              p_offer_token_hash: offerTokenHash,
            });

          const quoteExpiresAtMs = privateQuote
            ? new Date(privateQuote.checkout_expires_at).getTime()
            : Number.POSITIVE_INFINITY;
          prepared = {
            kind: "workshop",
            reused: workshopHold.reused,
            checkoutId: workshopHold.checkout_id,
            checkoutStatus: workshopHold.checkout_status ?? "creating",
            stripeCheckoutSessionId: workshopHold.stripe_checkout_session_id,
            checkoutExpiresAt: workshopHold.checkout_expires_at,
            checkoutDeadlineMs: Math.min(
              new Date(workshopHold.hold_expires_at).getTime(),
              new Date(workshopHold.checkout_expires_at).getTime(),
              new Date(workshopHold.start_at).getTime(),
              quoteExpiresAtMs,
            ),
            stripePriceId: workshopHold.stripe_price_id,
            stripeProductId: workshopHold.stripe_product_id,
            amountCents: workshopHold.amount_cents,
            currency: workshopHold.currency,
            targetSlug: workshopSlug,
            metadata: {
              checkout_id: workshopHold.checkout_id,
              checkout_kind: "workshop",
              hold_id: workshopHold.hold_id,
              session_id: workshopHold.session_id,
              course_id: workshopHold.course_id,
              ...(privateQuote ? { quote_id: privateQuote.quote_id } : {}),
            },
          };
        }

        await rpc(ctx.supabaseAdmin, "record_checkout_legal_acceptance", {
          p_checkout_id: prepared.checkoutId,
          p_user_id: user.id,
          p_documents: CHECKOUT_LEGAL_DOCUMENT_KEYS.map((key) => ({
            document_key: LEGAL_DOCUMENTS[key].key,
            document_version: LEGAL_DOCUMENTS[key].version,
          })),
        });

        await validateCatalogPrice(stripe, {
          priceId: prepared.stripePriceId,
          productId: prepared.stripeProductId,
          amountCents: prepared.amountCents,
          currency: prepared.currency,
        }, prepared.kind === "workshop" ? "workshop" : "service offering");

        const checkoutWindowTooShort = !Number.isFinite(prepared.checkoutDeadlineMs)
          || prepared.checkoutDeadlineMs <= Date.now() + stripeMinimumWindowMs;

        if (!prepared.reused) {
          if (checkoutWindowTooShort) {
            throw new ApiError(
              "checkout_window_too_short",
              prepared.kind === "workshop"
                ? "There is not enough time remaining before this workshop starts."
                : "There is not enough time remaining to start this checkout.",
              409,
            );
          }
          break;
        }

        if (prepared.checkoutStatus === "payment_pending") {
          throw new ApiError(
            "checkout_payment_pending",
            "Your previous payment is still being processed.",
            409,
          );
        }

        if (prepared.checkoutStatus === "open" && prepared.stripeCheckoutSessionId) {
          const existing = await stripe.checkout.sessions.retrieve(prepared.stripeCheckoutSessionId);
          const existingOutlivesDeadline = (
            !existing.expires_at
            || existing.expires_at * 1_000 > prepared.checkoutDeadlineMs
          );
          if (existing.status === "open" && (existingOutlivesDeadline || checkoutWindowTooShort)) {
            await stripe.checkout.sessions.expire(existing.id);
          } else if (existing.status === "open" && existing.url) {
            return ok({
              checkoutUrl: existing.url,
              expiresAt: new Date(prepared.checkoutDeadlineMs).toISOString(),
              checkoutRef: prepared.checkoutId,
            });
          }
          if (existing.status === "open" && !existingOutlivesDeadline && !checkoutWindowTooShort) {
            await stripe.checkout.sessions.expire(existing.id);
          }
          if (existing.status === "complete") {
            throw new ApiError(
              "checkout_processing",
              "Your previous checkout is being processed.",
              409,
            );
          }
        }

        const failed = await rpc<FailedAttempt>(ctx.supabaseAdmin, "fail_checkout_attempt", {
          p_checkout_id: prepared.checkoutId,
          p_user_id: user.id,
          p_reason: "superseded_before_checkout_creation",
          p_expected_status: prepared.checkoutStatus,
        });

        if (!failed.released && failed.checkout_status === "payment_pending") {
          throw new ApiError(
            "checkout_payment_pending",
            "Your previous payment is still being processed.",
            409,
          );
        }
        if (checkoutWindowTooShort) {
          throw new ApiError(
            "checkout_window_too_short",
            prepared.kind === "workshop"
              ? "There is not enough time remaining before this workshop starts."
              : "There is not enough time remaining to start this checkout.",
            409,
          );
        }
      }

      if (!prepared || prepared.reused) {
        throw new ApiError(
          "checkout_in_progress",
          "A checkout is already being prepared. Please try again.",
          409,
        );
      }
      if (
        !Number.isFinite(prepared.checkoutDeadlineMs)
        || prepared.checkoutDeadlineMs <= Date.now() + stripeMinimumWindowMs
      ) {
        throw new ApiError(
          "checkout_window_too_short",
          "There is not enough time remaining to start this checkout.",
          409,
        );
      }
      if (
        privateQuote
        && new Date(prepared.checkoutExpiresAt).getTime()
          > new Date(privateQuote.checkout_expires_at).getTime()
      ) {
        throw new ApiError(
          "checkout_window_too_short",
          "There is not enough time remaining to start this checkout.",
          409,
        );
      }

      const siteUrl = env("PUBLIC_SITE_URL").replace(/\/$/u, "");
      const automaticTaxEnabled = Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED")?.toLowerCase() === "true";
      const targetQuery = prepared.kind === "service_order"
        ? `target=service&slug=${encodeURIComponent(prepared.targetSlug)}`
        : `target=workshop&workshop=${encodeURIComponent(prepared.targetSlug)}`;
      const cancelUrl = quoteToken
        ? `${siteUrl}/account/private-quote?quote=${encodeURIComponent(quoteToken)}&checkout=cancelled`
        : `${siteUrl}/checkout/cancel/?${targetQuery}`;

      stripeSession = await stripe.checkout.sessions.create({
        mode: "payment",
        integration_identifier: "clearstep_qmtxvbrk",
        customer_email: user.email,
        client_reference_id: prepared.checkoutId,
        line_items: [{ price: prepared.stripePriceId, quantity: 1 }],
        invoice_creation: { enabled: true },
        expires_at: Math.floor(prepared.checkoutDeadlineMs / 1_000),
        success_url:
          `${siteUrl}/checkout/success/?session_id={CHECKOUT_SESSION_ID}&${targetQuery}`,
        cancel_url: cancelUrl,
        metadata: prepared.metadata,
        payment_intent_data: { metadata: prepared.metadata },
        ...(automaticTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
      }, {
        idempotencyKey: prepared.kind === "workshop"
          ? `clearstep-checkout-${prepared.checkoutId}`
          : `bnc-service-checkout-${prepared.checkoutId}`,
      });

      await rpc(
        ctx.supabaseAdmin,
        prepared.kind === "service_order"
          ? "attach_service_stripe_checkout"
          : "attach_stripe_checkout",
        {
          p_checkout_id: prepared.checkoutId,
          p_user_id: user.id,
          p_stripe_checkout_session_id: stripeSession.id,
          p_stripe_customer_id: typeof stripeSession.customer === "string"
            ? stripeSession.customer
            : stripeSession.customer?.id ?? null,
        },
      );

      return ok({
        checkoutUrl: stripeSession.url,
        expiresAt: new Date(prepared.checkoutDeadlineMs).toISOString(),
        checkoutRef: prepared.checkoutId,
      }, 201);
    } catch (error) {
      if (stripeSession?.id) {
        try {
          await stripe.checkout.sessions.expire(stripeSession.id);
        } catch (expireError) {
          console.error("Unable to expire unattached Stripe Checkout Session", expireError);
        }
      }

      const activeAttempt = serviceAttempt ?? workshopHold;
      if (activeAttempt?.checkout_id && !activeAttempt.reused) {
        try {
          const user = requireUser(ctx.userClaims);
          await rpc(ctx.supabaseAdmin, "fail_checkout_attempt", {
            p_checkout_id: activeAttempt.checkout_id,
            p_user_id: user.id,
            p_reason: error instanceof Error ? error.message : "checkout_creation_failed",
            p_expected_status: null,
          });
        } catch (releaseError) {
          console.error("Unable to release failed checkout attempt", releaseError);
        }
      }
      return handleError(error);
    }
  }),
};
