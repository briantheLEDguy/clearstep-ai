import Stripe from "npm:stripe@22.3.2";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { CHECKOUT_LEGAL_DOCUMENT_KEYS, LEGAL_DOCUMENTS } from "../../../shared/legal-documents.ts";
import { requireUser } from "../_shared/auth.ts";
import { resolveWorkshopSession } from "../_shared/catalog.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, ok, readJson } from "../_shared/http.ts";
import { validateWorkshopPrice } from "../_shared/stripe.ts";

type CheckoutRequest = {
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

type Hold = {
  reused: boolean;
  checkout_id: string;
  checkout_status: "creating" | "open" | "payment_pending";
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

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    let hold: Hold | null = null;
    let stripeSession: Stripe.Checkout.Session | null = null;
    let privateQuote: PrivateQuote | null = null;
    let checkoutDeadlineMs: number | null = null;
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
      let sessionId: string;
      let workshopSlug: string;
      let quoteToken: string | null = null;

      if (typeof body.quoteToken === "string" && body.quoteToken.trim()) {
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
          new Date(privateQuote.checkout_expires_at).getTime() <=
            Date.now() + stripeMinimumWindowMs + checkoutCreationCushionMs
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
        sessionId = await resolveWorkshopSession(
          ctx.supabaseAdmin,
          body.workshopSlug,
          body.sessionRef,
        );
        workshopSlug = String(body.workshopSlug);
      }
      const offerTokenHash = typeof body.offerToken === "string" && body.offerToken
        ? await sha256Hex(body.offerToken)
        : null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        hold = privateQuote
          ? await rpc<Hold>(ctx.supabaseAdmin, "create_private_quote_checkout_hold", {
            p_quote_id: privateQuote.quote_id,
            p_quote_checkout_expires_at: privateQuote.checkout_expires_at,
            p_session_id: sessionId,
            p_user_id: user.id,
            p_email: user.email,
          })
          : await rpc<Hold>(ctx.supabaseAdmin, "create_checkout_hold", {
            p_session_id: sessionId,
            p_user_id: user.id,
            p_email: user.email,
            p_offer_token_hash: offerTokenHash,
          });

        await rpc(ctx.supabaseAdmin, "record_checkout_legal_acceptance", {
          p_checkout_id: hold.checkout_id,
          p_user_id: user.id,
          p_documents: CHECKOUT_LEGAL_DOCUMENT_KEYS.map((key) => ({
            document_key: LEGAL_DOCUMENTS[key].key,
            document_version: LEGAL_DOCUMENTS[key].version,
          })),
        });

        await validateWorkshopPrice(stripe, {
          priceId: hold.stripe_price_id,
          productId: hold.stripe_product_id,
          amountCents: hold.amount_cents,
          currency: hold.currency,
        });

        const holdExpiresAtMs = new Date(hold.hold_expires_at).getTime();
        const databaseCheckoutExpiresAtMs = new Date(hold.checkout_expires_at).getTime();
        const sessionStartsAtMs = new Date(hold.start_at).getTime();
        const quoteExpiresAtMs = privateQuote
          ? new Date(privateQuote.checkout_expires_at).getTime()
          : Number.POSITIVE_INFINITY;
        checkoutDeadlineMs = Math.min(
          holdExpiresAtMs,
          databaseCheckoutExpiresAtMs,
          sessionStartsAtMs,
          quoteExpiresAtMs,
        );
        const checkoutWindowTooShort = !Number.isFinite(checkoutDeadlineMs) ||
          checkoutDeadlineMs <= Date.now() + stripeMinimumWindowMs;

        if (!hold.reused && checkoutWindowTooShort) {
          throw new ApiError(
            "checkout_window_too_short",
            "There is not enough time remaining before this workshop starts.",
            409,
          );
        }

        if (!hold.reused) break;

        if (hold.checkout_status === "payment_pending") {
          throw new ApiError(
            "checkout_payment_pending",
            "Your previous payment is still being processed.",
            409,
          );
        }

        if (hold.checkout_status === "open" && hold.stripe_checkout_session_id) {
          const existing = await stripe.checkout.sessions.retrieve(hold.stripe_checkout_session_id);
          const existingOutlivesDeadline = (
            !existing.expires_at ||
            existing.expires_at * 1_000 > checkoutDeadlineMs
          );
          if (existing.status === "open" && (existingOutlivesDeadline || checkoutWindowTooShort)) {
            await stripe.checkout.sessions.expire(existing.id);
          } else if (existing.status === "open" && existing.url) {
            return ok({
              checkoutUrl: existing.url,
              expiresAt: new Date(checkoutDeadlineMs).toISOString(),
              checkoutRef: hold.checkout_id,
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
          p_checkout_id: hold.checkout_id,
          p_user_id: user.id,
          p_reason: "superseded_before_checkout_creation",
          p_expected_status: hold.checkout_status,
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
            "There is not enough time remaining before this workshop starts.",
            409,
          );
        }
      }

      if (!hold || hold.reused) {
        throw new ApiError(
          "checkout_in_progress",
          "A checkout is already being prepared. Please try again.",
          409,
        );
      }

      const holdExpiresAtMs = new Date(hold.hold_expires_at).getTime();
      const databaseCheckoutExpiresAtMs = new Date(hold.checkout_expires_at).getTime();
      const quoteExpiresAtMs = privateQuote
        ? new Date(privateQuote.checkout_expires_at).getTime()
        : null;
      if (
        checkoutDeadlineMs === null ||
        !Number.isFinite(holdExpiresAtMs) ||
        !Number.isFinite(databaseCheckoutExpiresAtMs) ||
        checkoutDeadlineMs <= Date.now() + stripeMinimumWindowMs ||
        (quoteExpiresAtMs !== null && databaseCheckoutExpiresAtMs > quoteExpiresAtMs)
      ) {
        throw new ApiError(
          "checkout_window_too_short",
          "There is not enough time remaining to start this checkout.",
          409,
        );
      }

      const siteUrl = env("PUBLIC_SITE_URL").replace(/\/$/u, "");
      const metadata = {
        checkout_id: hold.checkout_id,
        hold_id: hold.hold_id,
        session_id: hold.session_id,
        course_id: hold.course_id,
        user_id: user.id,
        ...(privateQuote ? { quote_id: privateQuote.quote_id } : {}),
      };
      const automaticTaxEnabled = Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED")?.toLowerCase() === "true";
      const cancelUrl = quoteToken
        ? `${siteUrl}/account/private-quote?quote=${encodeURIComponent(quoteToken)}&checkout=cancelled`
        : `${siteUrl}/checkout/cancel?workshop=${encodeURIComponent(workshopSlug)}`;

      stripeSession = await stripe.checkout.sessions.create({
        mode: "payment",
        integration_identifier: "clearstep_qmtxvbrk",
        customer_email: user.email,
        client_reference_id: hold.checkout_id,
        line_items: [{ price: hold.stripe_price_id, quantity: 1 }],
        invoice_creation: { enabled: true },
        expires_at: Math.floor(checkoutDeadlineMs / 1_000),
        success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        metadata,
        payment_intent_data: { metadata },
        ...(automaticTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
      }, { idempotencyKey: `clearstep-checkout-${hold.checkout_id}` });

      await rpc(ctx.supabaseAdmin, "attach_stripe_checkout", {
        p_checkout_id: hold.checkout_id,
        p_user_id: user.id,
        p_stripe_checkout_session_id: stripeSession.id,
        p_stripe_customer_id: typeof stripeSession.customer === "string"
          ? stripeSession.customer
          : stripeSession.customer?.id ?? null,
      });

      return ok({
        checkoutUrl: stripeSession.url,
        expiresAt: new Date(checkoutDeadlineMs).toISOString(),
        checkoutRef: hold.checkout_id,
      }, 201);
    } catch (error) {
      if (stripeSession?.id) {
        try {
          await stripe.checkout.sessions.expire(stripeSession.id);
        } catch (expireError) {
          console.error("Unable to expire unattached Stripe Checkout Session", expireError);
        }
      }
      if (hold?.checkout_id && !hold.reused) {
        try {
          const user = requireUser(ctx.userClaims);
          await rpc(ctx.supabaseAdmin, "fail_checkout_attempt", {
            p_checkout_id: hold.checkout_id,
            p_user_id: user.id,
            p_reason: error instanceof Error ? error.message : "checkout_creation_failed",
            p_expected_status: null,
          });
        } catch (releaseError) {
          console.error("Unable to release failed checkout hold", releaseError);
        }
      }
      return handleError(error);
    }
  }),
};
