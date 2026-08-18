import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckoutStatusFromQuery } from "@/components/query-routed-content";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Booking received",
  description: "Your Clearstep workshop payment has returned successfully.",
  robots: { index: false, follow: false },
};

export default function CheckoutSuccessPage() {
  return (
    <PublicPage>
      <section className="shell py-16 md:py-24">
        <div className="mx-auto max-w-3xl rounded-[32px] bg-[var(--mint)] p-8 text-center shadow-[var(--shadow)] md:p-14">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--green)] text-3xl font-bold text-white" aria-hidden="true">✓</span>
          <p className="eyebrow mt-7">Payment returned successfully</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.4rem)] leading-[1.04]">Thanks—your next clear step is underway.</h1>
          <Suspense fallback={<p role="status">Checking your booking…</p>}>
            <CheckoutStatusFromQuery />
          </Suspense>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link className="button button-primary" href="/account">View your account</Link>
            <Link className="button border border-[var(--navy)]" href="/workshops">Browse workshops</Link>
          </div>
          <p className="mb-0 mt-6 text-sm">Please do not book again if confirmation takes a moment. Payment confirmation is completed securely in the background.</p>
        </div>
      </section>
    </PublicPage>
  );
}
