import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  description: "Your Clearstep workshop checkout was cancelled.",
  robots: { index: false, follow: false },
};

export default function CheckoutCancelPage() {
  return (
    <PublicPage>
      <section className="shell py-16 md:py-24">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-[var(--border)] bg-white p-8 text-center shadow-[var(--shadow)] md:p-14">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--yellow)] text-3xl font-bold" aria-hidden="true">←</span>
          <p className="eyebrow mt-7">Checkout cancelled</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.4rem)] leading-[1.04]">No problem. Your booking wasn’t completed.</h1>
          <p className="mx-auto mt-6 max-w-xl text-lg">If no payment completed, any temporary seat hold will release automatically. You can return to the workshop and try again when you’re ready.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link className="button button-primary" href="/workshops">Return to workshops</Link>
            <a className="button border border-[var(--navy)]" href={`mailto:${COMPANY_DETAILS.email}`}>Ask for help</a>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
