"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckoutLegalAcceptance } from "@/components/checkout-legal-acceptance";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";
import { COMPANY_DETAILS } from "@/shared/company-details";

type QuoteState = "checking" | "ready" | "signed-out" | "loading" | "invalid" | "error";

function validToken(value?: string): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function PrivateQuoteCheckout({ quoteToken }: { quoteToken?: string }) {
  const configured = isSupabaseConfigured();
  const tokenValid = validToken(quoteToken);
  const [state, setState] = useState<QuoteState>(() => !tokenValid ? "invalid" : configured ? "checking" : "error");
  const [message, setMessage] = useState(() => !tokenValid
    ? "This quote link is invalid or incomplete."
    : configured
      ? "Checking your account…"
      : "Secure checkout is not connected in this environment.");

  useEffect(() => {
    if (!tokenValid) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;
    let active = true;

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) {
        setState("signed-out");
        setMessage("Sign in with the verified email address that received this quote.");
        return;
      }
      setState("ready");
      setMessage("You’re signed in. We’ll confirm this personal quote securely when you continue.");
    });

    return () => {
      active = false;
    };
  }, [tokenValid]);
  const [legalAccepted, setLegalAccepted] = useState(false);

  async function openCheckout() {
    if (!tokenValid) return;
    if (!legalAccepted) {
      setState("error");
      setMessage("Please read and accept the Terms and Cancellation policy before opening checkout.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) return;

    setState("loading");
    setMessage("Opening secure checkout…");
    const { data, error } = await client.functions.invoke("create-checkout", {
      body: { quoteToken, legalAccepted: true },
    });

    if (error) {
      setState("error");
      setMessage(await functionErrorMessage(error, "We couldn’t open this quote. It may have expired or belong to another email address."));
      return;
    }

    const result = unwrapFunctionData<{ checkoutUrl?: unknown }>(data);
    if (!result || typeof result.checkoutUrl !== "string") {
      setState("error");
      setMessage("Checkout did not return a payment link. Please contact Brian before trying again.");
      return;
    }

    window.location.assign(result.checkoutUrl);
  }

  const returnPath = tokenValid ? `/account/private-quote?quote=${quoteToken}` : "/account/private-quote";

  return (
    <div className="mx-auto max-w-xl rounded-[28px] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow)] md:p-9">
      <p
        className={`m-0 rounded-2xl p-4 ${state === "error" || state === "invalid" ? "bg-[#fff0ec] text-[#8f2f1f]" : "bg-[var(--mint)]"}`}
        role={state === "error" || state === "invalid" ? "alert" : "status"}
        aria-live="polite"
      >
        {message}
      </p>
      {state === "signed-out" ? (
        <Link className="button button-primary mt-6 w-full text-center" href={`/sign-in?next=${encodeURIComponent(returnPath)}`}>Sign in to continue</Link>
      ) : null}
      {state === "ready" || state === "loading" ? (
        <>
          <CheckoutLegalAcceptance checked={legalAccepted} onChange={setLegalAccepted} />
          <button
            className="button button-primary mt-6 w-full cursor-pointer border-0 disabled:cursor-wait disabled:opacity-65"
            type="button"
            disabled={state === "loading" || !legalAccepted}
            onClick={openCheckout}
          >
            {state === "loading" ? "Opening checkout…" : "Review quote and pay"}
          </button>
        </>
      ) : null}
      <p className="mb-0 mt-5 text-sm text-[color:rgba(16,42,67,.68)]">
        The link is personal, single-purpose, and tied to the quoted email address. Questions? <a className="font-bold underline" href={`mailto:${COMPANY_DETAILS.email}`}>Email us</a>.
      </p>
    </div>
  );
}
