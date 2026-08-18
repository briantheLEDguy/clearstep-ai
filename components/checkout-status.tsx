"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type EnrollmentRecord = {
  id: string;
  status: "cancelled" | "confirmed" | "pending_payment" | "refunded";
  confirmed_at: string | null;
  workshop_sessions: {
    start_at: string;
    venue: string | null;
    courses: { slug: string; title: string } | null;
  } | null;
};

type CheckoutState = {
  kind: "checking" | "confirmed" | "delayed" | "error";
  message: string;
};

const MAX_STATUS_CHECKS = 8;
const STATUS_CHECK_INTERVAL_MS = 2_000;

function initialState(checkoutSessionId?: string): CheckoutState {
  if (!checkoutSessionId) {
    return {
      kind: "error",
      message: "We couldn’t read the checkout reference. Check your account or confirmation email before trying again.",
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      kind: "error",
      message: "Online enrollment status is being connected. Check your confirmation email or contact Brian before trying again.",
    };
  }

  return {
    kind: "checking",
    message: "We’re confirming your payment and creating your enrollment.",
  };
}

export function CheckoutStatus({ checkoutSessionId }: { checkoutSessionId?: string }) {
  const [state, setState] = useState<CheckoutState>(() => initialState(checkoutSessionId));

  useEffect(() => {
    if (!checkoutSessionId) return;
    const sessionId = checkoutSessionId;

    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function checkEnrollment(attempt: number) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!active) return;

      if (userError || !userData.user) {
        setState({
          kind: "error",
          message: "Sign in with the email used at checkout to view your enrollment status.",
        });
        return;
      }

      const { data, error } = await supabase
        .from("enrollments")
        .select("id,status,confirmed_at,workshop_sessions(start_at,venue,courses(slug,title))")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      if (!active) return;

      if (!error && data) {
        const enrollment = data as unknown as EnrollmentRecord;

        if (enrollment.status === "confirmed") {
          const workshopTitle = enrollment.workshop_sessions?.courses?.title;
          setState({
            kind: "confirmed",
            message: workshopTitle
              ? `Your place in ${workshopTitle} is confirmed. Joining details are on their way to your inbox.`
              : "Your place is confirmed. Joining details are on their way to your inbox.",
          });
          void trackEvent("checkout_confirmed");
          return;
        }

        if (enrollment.status === "cancelled" || enrollment.status === "refunded") {
          setState({
            kind: "error",
            message: "This booking is not active. Please check your email or contact Brian if that looks unexpected.",
          });
          return;
        }
      }

      if (attempt < MAX_STATUS_CHECKS) {
        retryTimer = setTimeout(() => void checkEnrollment(attempt + 1), STATUS_CHECK_INTERVAL_MS);
        return;
      }

      setState({
        kind: error ? "error" : "delayed",
        message: error
          ? "We couldn’t load your enrollment yet. Your payment will not be charged again—check your account or confirmation email shortly."
          : "Payment confirmation is taking a little longer than usual. Please check your account or confirmation email shortly, and do not book again.",
      });
    }

    void checkEnrollment(1);

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [checkoutSessionId]);

  return (
    <p
      className={`mb-0 mt-5 text-lg ${state.kind === "error" ? "text-[#8f2f1f]" : ""}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {state.message}
    </p>
  );
}
