import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutCancelContent } from "@/components/checkout-return-content";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  description: "Your BNC Consulting checkout was cancelled.",
  robots: { index: false, follow: false },
};

export default function CheckoutCancelPage() {
  return (
    <PublicPage brandKey="bnc">
      <section className="shell py-16 md:py-24">
        <Suspense fallback={<p role="status">Loading checkout details…</p>}><CheckoutCancelContent /></Suspense>
      </section>
    </PublicPage>
  );
}
