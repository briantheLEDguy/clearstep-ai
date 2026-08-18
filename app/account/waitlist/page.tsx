import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";
import { WaitlistOffer } from "@/components/waitlist-offer";

export const metadata: Metadata = {
  title: "Waitlist offer",
  description: "Review a private Clearstep waitlist offer and continue to secure checkout.",
  robots: { index: false, follow: false, nocache: true },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export default async function WaitlistOfferPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[]; offer?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawSession = Array.isArray(params.session) ? params.session[0] : params.session;
  const rawOffer = Array.isArray(params.offer) ? params.offer[0] : params.offer;
  const sessionRef = rawSession && UUID_PATTERN.test(rawSession) ? rawSession : undefined;
  const offerToken = rawOffer && rawOffer.length >= 32 && rawOffer.length <= 200 ? rawOffer : undefined;
  const query = new URLSearchParams();
  if (sessionRef) query.set("session", sessionRef);
  if (offerToken) query.set("offer", offerToken);
  const returnPath = `/account/waitlist${query.size ? `?${query}` : ""}`;

  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <p className="eyebrow">A place is available</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Your waitlist offer is ready.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg">Review the session, sign in with the invited account, and complete payment before the offer expires.</p>
        </div>
        <WaitlistOffer sessionRef={sessionRef} offerToken={offerToken} returnPath={returnPath} />
      </section>
    </PublicPage>
  );
}
