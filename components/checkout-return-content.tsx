"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckoutStatusFromQuery } from "@/components/query-routed-content";
import { COMPANY_DETAILS } from "@/shared/company-details";

type CheckoutTarget = "service" | "workshop" | "unknown";

function checkoutTarget(value: string | null): CheckoutTarget {
  return value === "service" || value === "workshop" ? value : "unknown";
}

export function CheckoutSuccessContent() {
  const target = checkoutTarget(useSearchParams().get("target"));
  const serviceOrder = target === "service";
  const workshop = target === "workshop";

  return (
    <div className="mx-auto max-w-3xl rounded-[32px] bg-[var(--color-surface-soft)] p-8 text-center shadow-[var(--shadow-elevated)] md:p-14">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-positive)] text-3xl font-bold text-white" aria-hidden="true">✓</span>
      <p className="eyebrow mt-7">Payment returned successfully</p>
      <h1 className="text-[clamp(2.7rem,7vw,4.4rem)] leading-[1.04]">
        {serviceOrder ? "Thanks—your Plate & Post project is underway." : workshop ? "Thanks—your next clear step is underway." : "Thanks—your order is being confirmed."}
      </h1>
      {serviceOrder ? (
        <p className="mb-0 mt-5 text-lg" role="status">
          We’re confirming the order in your BNC account. Plate &amp; Post will follow up after confirmation to arrange the brief and scheduling.
        </p>
      ) : workshop ? <CheckoutStatusFromQuery /> : (
        <p className="mb-0 mt-5 text-lg" role="status">Check your BNC account or confirmation email for the latest status before trying again.</p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link className="button button-primary" href="/account">View your account</Link>
        <Link className="button border border-[var(--color-text)]" href={serviceOrder ? "/plate-and-post/services" : workshop ? "/clearstep/workshops" : "/"}>
          {serviceOrder ? "View Plate & Post services" : workshop ? "Browse workshops" : "Back to BNC Consulting"}
        </Link>
      </div>
      <p className="mb-0 mt-6 text-sm">Please do not pay again if confirmation takes a moment. Payment confirmation is completed securely in the background.</p>
    </div>
  );
}

export function CheckoutCancelContent() {
  const target = checkoutTarget(useSearchParams().get("target"));
  const serviceOrder = target === "service";
  const workshop = target === "workshop";

  return (
    <div className="mx-auto max-w-3xl rounded-[32px] border border-[var(--color-border)] bg-white p-8 text-center shadow-[var(--shadow-elevated)] md:p-14">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-accent)] text-3xl font-bold" aria-hidden="true">←</span>
      <p className="eyebrow mt-7">Checkout cancelled</p>
      <h1 className="text-[clamp(2.7rem,7vw,4.4rem)] leading-[1.04]">
        {serviceOrder ? "No problem. Your Plate & Post order wasn’t completed." : workshop ? "No problem. Your workshop booking wasn’t completed." : "No problem. Your checkout wasn’t completed."}
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg">
        {serviceOrder
          ? "If no payment completed, no service order is confirmed. Return to the packages when you’re ready, or ask us for help with the brief."
          : workshop
            ? "If no payment completed, any temporary seat hold will release automatically. You can return to the workshop and try again when you’re ready."
            : "If no payment completed, no order is confirmed. You can safely return to BNC Consulting and choose your next step."}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link className="button button-primary" href={serviceOrder ? "/plate-and-post/services" : workshop ? "/clearstep/workshops" : "/"}>
          {serviceOrder ? "Return to Plate & Post services" : workshop ? "Return to workshops" : "Back to BNC Consulting"}
        </Link>
        <a className="button border border-[var(--color-text)]" href={`mailto:${COMPANY_DETAILS.email}`}>Ask for help</a>
      </div>
    </div>
  );
}
