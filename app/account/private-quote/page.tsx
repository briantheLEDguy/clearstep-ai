import type { Metadata } from "next";
import { PrivateQuoteCheckout } from "@/components/private-quote-checkout";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Private workshop quote",
  description: "Continue to secure checkout for your Clearstep private workshop.",
  robots: { index: false, follow: false },
};

export default async function PrivateQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string }>;
}) {
  const { quote } = await searchParams;

  return (
    <PublicPage>
      <section className="shell py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Private workshop</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Your tailored workshop is ready.</h1>
          <p className="mx-auto mt-6 max-w-xl text-lg">Sign in with the email address that received the quote, then continue to Stripe’s secure checkout.</p>
        </div>
        <div className="mt-10">
          <PrivateQuoteCheckout quoteToken={quote} />
        </div>
      </section>
    </PublicPage>
  );
}
