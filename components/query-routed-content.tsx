"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CheckoutStatus } from "@/components/checkout-status";
import { PrivateQuoteCheckout } from "@/components/private-quote-checkout";
import { SignInForm } from "@/components/sign-in-form";
import { StaffInviteAcceptance } from "@/components/staff-invite-acceptance";
import { WaitlistOffer } from "@/components/waitlist-offer";
import { safeReturnPath } from "@/lib/supabase/redirects";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function LegacyBookingRedirect() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const destination = sessionId?.startsWith("cs_")
    ? `/checkout/success?session_id=${encodeURIComponent(sessionId)}&target=workshop`
    : "/account";

  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return <p role="status">Taking you to your booking…</p>;
}

export function PrivateQuoteCheckoutFromQuery() {
  const quote = useSearchParams().get("quote") ?? undefined;
  return <PrivateQuoteCheckout quoteToken={quote} />;
}

export function WaitlistOfferFromQuery() {
  const searchParams = useSearchParams();
  const rawSession = searchParams.get("session");
  const rawOffer = searchParams.get("offer");
  const sessionRef = rawSession && UUID_PATTERN.test(rawSession) ? rawSession : undefined;
  const offerToken = rawOffer && rawOffer.length >= 32 && rawOffer.length <= 200 ? rawOffer : undefined;
  const query = new URLSearchParams();
  if (sessionRef) query.set("session", sessionRef);
  if (offerToken) query.set("offer", offerToken);
  const returnPath = `/account/waitlist${query.size ? `?${query}` : ""}`;

  return <WaitlistOffer sessionRef={sessionRef} offerToken={offerToken} returnPath={returnPath} />;
}

export function CheckoutStatusFromQuery() {
  const rawId = useSearchParams().get("session_id");
  const checkoutSessionId = rawId?.startsWith("cs_") ? rawId : undefined;
  return <CheckoutStatus checkoutSessionId={checkoutSessionId} />;
}

export function SignInFormFromQuery() {
  const nextPath = safeReturnPath(useSearchParams().get("next") ?? undefined);
  return <SignInForm nextPath={nextPath} />;
}

export function StaffInviteAcceptanceFromQuery() {
  const rawToken = useSearchParams().get("token");
  const token = rawToken && rawToken.length >= 32 && rawToken.length <= 200 ? rawToken : undefined;
  const returnPath = token ? `/staff/invite?token=${encodeURIComponent(token)}` : "/staff/invite";
  return <StaffInviteAcceptance token={token} returnPath={returnPath} />;
}
