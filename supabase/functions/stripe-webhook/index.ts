import Stripe from "npm:stripe@22.3.2";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, errorMessage, handleError, methodNotAllowed, ok } from "../_shared/http.ts";

const stripe = new Stripe(env("STRIPE_API_KEY"), {
  apiVersion: "2026-06-24.dahlia",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    let signatureVerified = false;
    let verifiedEvent: Stripe.Event | null = null;
    let eventProcessingCompleted = false;
    try {
      const signature = req.headers.get("stripe-signature");
      if (!signature) {
        throw new ApiError("stripe_signature_missing", "Stripe signature is required.", 400);
      }

      // Stripe signature verification must use the untouched raw request body.
      const rawBody = await req.text();
      try {
        verifiedEvent = await stripe.webhooks.constructEventAsync(
          rawBody,
          signature,
          env("STRIPE_WEBHOOK_SIGNING_SECRET"),
          undefined,
          cryptoProvider,
        );
        signatureVerified = true;
      } catch {
        throw new ApiError("stripe_signature_invalid", "Stripe signature verification failed.", 400);
      }
      if (!verifiedEvent) {
        throw new ApiError("stripe_event_invalid", "Stripe returned no verified event.", 400);
      }

      const result = await rpc<Record<string, unknown>>(ctx.supabaseAdmin, "process_stripe_event", {
        p_stripe_event_id: verifiedEvent.id,
        p_event_type: verifiedEvent.type,
        p_payload: verifiedEvent,
      });
      eventProcessingCompleted = true;
      const amountMismatch = result.amount_mismatch === true;
      const refundRemediationRequired = result.requires_refund === true;
      const refundRemediationReason = typeof result.remediation_reason === "string"
        ? result.remediation_reason.slice(0, 200)
        : "payment_requires_refund";
      await rpc(ctx.supabaseAdmin, "record_integration_health", {
        p_integration: "stripe_webhook",
        p_success: !amountMismatch && !refundRemediationRequired,
        p_error: amountMismatch
          ? "checkout_amount_or_currency_mismatch"
          : refundRemediationRequired
          ? refundRemediationReason
          : null,
        p_metadata: {
          eventType: verifiedEvent.type,
          requiresRefund: refundRemediationRequired,
          remediationReason: refundRemediationRequired ? refundRemediationReason : null,
          checkoutId: result.checkout_id ?? null,
          paymentId: result.payment_id ?? null,
          serviceOrderId: result.service_order_id ?? null,
          paymentStatus: result.payment_status ?? null,
          fulfillmentStatus: result.fulfillment_status ?? null,
        },
      });
      return ok({ received: true, ...result });
    } catch (error) {
      if (signatureVerified && verifiedEvent && !eventProcessingCompleted) {
        try {
          await rpc(ctx.supabaseAdmin, "record_stripe_webhook_failure", {
            p_stripe_event_id: verifiedEvent.id,
            p_event_type: verifiedEvent.type,
            p_error: errorMessage(error),
          });
        } catch (failureRecordError) {
          console.error("Unable to persist Stripe webhook failure", failureRecordError);
        }
      }
      if (signatureVerified) {
        try {
          await rpc(ctx.supabaseAdmin, "record_integration_health", {
            p_integration: "stripe_webhook",
            p_success: false,
            p_error: error instanceof Error ? error.message : "stripe_webhook_processing_failed",
            p_metadata: {},
          });
        } catch (healthError) {
          console.error("Unable to record Stripe webhook health", healthError);
        }
      }
      return handleError(error);
    }
  }),
};
