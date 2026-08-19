import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutSuccessContent } from "@/components/checkout-return-content";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Payment received",
  description: "Your BNC Consulting payment has returned successfully.",
  robots: { index: false, follow: false },
};

export default function CheckoutSuccessPage() {
  return (
    <PublicPage brandKey="bnc">
      <section className="shell py-16 md:py-24">
        <Suspense fallback={<p role="status">Checking your payment return…</p>}><CheckoutSuccessContent /></Suspense>
      </section>
    </PublicPage>
  );
}
