import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicPage } from "@/components/public-page";
import { WaitlistOfferFromQuery } from "@/components/query-routed-content";

export const metadata: Metadata = {
  title: "Waitlist offer",
  description: "Review a private Clearstep waitlist offer and continue to secure checkout.",
  robots: { index: false, follow: false, nocache: true },
};

export default function WaitlistOfferPage() {
  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <p className="eyebrow">A place is available</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Your waitlist offer is ready.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg">Review the session, sign in with the invited account, and complete payment before the offer expires.</p>
        </div>
        <Suspense fallback={<p role="status">Loading your waitlist offer…</p>}>
          <WaitlistOfferFromQuery />
        </Suspense>
      </section>
    </PublicPage>
  );
}
