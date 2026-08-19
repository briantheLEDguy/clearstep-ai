"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckoutLegalAcceptance } from "@/components/checkout-legal-acceptance";
import { parseCheckoutResponse } from "@/lib/checkout";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";
import type { PlatePostServiceSlug } from "@/lib/services";
import { COMPANY_DETAILS } from "@/shared/company-details";

export function ServiceCheckout({
  serviceSlug,
  serviceTitle,
  compact = false,
  staffPreview = false,
}: {
  serviceSlug: PlatePostServiceSlug;
  serviceTitle: string;
  compact?: boolean;
  staffPreview?: boolean;
}) {
  const router = useRouter();
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function continueToCheckout() {
    if (!legalAccepted) {
      setState("error");
      setMessage("Please read and accept the Terms and Cancellation policy before opening checkout.");
      return;
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setState("error");
      setMessage("Online ordering is being connected. Please email us and we’ll help with your project.");
      return;
    }

    setState("loading");
    setMessage("");
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) {
      const next = `/plate-and-post/services/${serviceSlug}`;
      router.push(`/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }

    const { data, error } = await client.functions.invoke("create-checkout", {
      body: {
        targetType: "service",
        serviceLine: "plate_and_post",
        offeringSlug: serviceSlug,
        legalAccepted: true,
      },
    });
    if (error) {
      setState("error");
      setMessage(await functionErrorMessage(error, "Checkout could not be opened. Please try again or email us for help."));
      return;
    }

    const result = parseCheckoutResponse(unwrapFunctionData(data));
    if (!result) {
      setState("error");
      setMessage("Checkout returned an invalid payment response. Please try again.");
      return;
    }
    window.location.assign(result.checkoutUrl);
  }

  return (
    <div className={compact ? "mt-4" : "mt-6"}>
      <CheckoutLegalAcceptance
        checked={legalAccepted}
        disabled={state === "loading"}
        id={`service-${serviceSlug}-legal-acceptance`}
        onChange={setLegalAccepted}
      />
      <button
        className="button button-primary mt-4 w-full border-0 enabled:cursor-pointer disabled:cursor-wait disabled:opacity-65"
        type="button"
        disabled={state === "loading" || !legalAccepted}
        onClick={continueToCheckout}
      >
        {state === "loading" ? "Opening secure checkout…" : staffPreview ? `Test checkout for ${serviceTitle}` : `Book ${serviceTitle}`}
      </button>
      {staffPreview ? <p className="mb-0 mt-3 text-xs font-bold uppercase tracking-[.08em]">Staff sandbox checkout · server permissions still apply</p> : null}
      {message ? <p className="mb-0 mt-3 text-sm text-[#8f2f1f]" role="alert" aria-live="polite">{message}</p> : null}
      {!compact ? (
        <a className="text-link mt-5 inline-block text-sm" href={`mailto:${COMPANY_DETAILS.email}?subject=${encodeURIComponent(`Question about ${serviceTitle}`)}`}>
          Ask a question before booking
        </a>
      ) : null}
    </div>
  );
}
