"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckoutLegalAcceptance } from "@/components/checkout-legal-acceptance";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";
import { COMPANY_DETAILS } from "@/shared/company-details";

type BookingPanelProps = {
  workshopSlug: string;
  workshopTitle: string;
  sessionId: string;
  seatsLeft: number;
  priceLabel: string;
};

export function BookingPanel({ workshopSlug, workshopTitle, sessionId, seatsLeft, priceLabel }: BookingPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const soldOut = seatsLeft < 1;

  async function continueToBooking() {
    if (!soldOut && !legalAccepted) {
      setState("error");
      setMessage("Please read and accept the Terms and Cancellation policy before opening checkout.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setState("error");
      setMessage("Online booking is being connected. Please email us and we’ll help reserve your place.");
      return;
    }

    setState("loading");
    setMessage("");

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) {
      const next = `/workshops/${workshopSlug}--${sessionId}`;
      router.push(`/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }

    const functionName = soldOut ? "join-waitlist" : "create-checkout";
    const { data, error } = await client.functions.invoke(functionName, {
      body: soldOut
        ? { workshopSlug, sessionRef: sessionId }
        : { workshopSlug, sessionRef: sessionId, legalAccepted: true },
    });

    if (error) {
      setState("error");
      setMessage(await functionErrorMessage(error, "Something went wrong. Please try again or email us for help."));
      return;
    }

    if (soldOut) {
      setState("success");
      setMessage("You’re on the waitlist. We’ll email you if a place becomes available.");
      return;
    }

    const result = unwrapFunctionData<{ checkoutUrl?: unknown; url?: unknown }>(data);
    const redirectUrl = typeof result?.checkoutUrl === "string"
      ? result.checkoutUrl
      : typeof result?.url === "string"
        ? result.url
        : null;

    if (!redirectUrl) {
      setState("error");
      setMessage("Checkout did not return a payment link. Please try again.");
      return;
    }

    window.location.assign(redirectUrl);
  }

  return (
    <aside className="rounded-[28px] bg-[var(--navy)] p-7 text-[var(--cream)] shadow-[var(--shadow)] md:p-9" aria-label="Book this workshop">
      <p className="m-0 text-sm font-bold uppercase tracking-[.1em] text-[var(--mint)]">
        {soldOut ? "Join the waitlist" : "Reserve your place"}
      </p>
      <p className="mb-1 mt-4 font-[var(--font-manrope)] text-3xl font-bold">{priceLabel}</p>
      <p className="m-0 text-sm text-white/70">Final price and any applicable tax are shown at checkout.</p>
      <p className="my-6 border-y border-white/15 py-5 font-semibold">
        {soldOut ? "This session is currently full." : `${seatsLeft} ${seatsLeft === 1 ? "place" : "places"} available`}
      </p>
      {!soldOut ? (
        <CheckoutLegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} tone="dark" />
      ) : null}
      <button
        className="button w-full border-0 bg-[var(--yellow)] text-[var(--navy)] enabled:cursor-pointer disabled:cursor-wait disabled:opacity-65"
        type="button"
        disabled={state === "loading" || state === "success" || (!soldOut && !legalAccepted)}
        onClick={continueToBooking}
      >
        {state === "loading" ? "One moment…" : soldOut ? "Join the waitlist" : "Continue to secure checkout"}
      </button>
      {message ? (
        <p
          className={`mb-0 mt-4 text-sm ${state === "error" ? "text-[#ffd9cf]" : "text-[var(--mint)]"}`}
          role={state === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      <p className="mb-0 mt-5 text-sm text-white/70">
        Booking is tied to your Clearstep account. New here? We’ll help you sign in first.
      </p>
      <a className="mt-4 inline-block text-sm font-bold text-[var(--mint)] underline underline-offset-4" href={`mailto:${COMPANY_DETAILS.email}?subject=${encodeURIComponent(`Question about ${workshopTitle}`)}`}>
        Ask a question before booking
      </a>
    </aside>
  );
}
