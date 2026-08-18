import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Booking confirmation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function LegacyBookingResultPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawSessionId = Array.isArray(params.session) ? params.session[0] : params.session;

  if (rawSessionId?.startsWith("cs_")) {
    redirect(`/checkout/success?session_id=${encodeURIComponent(rawSessionId)}`);
  }

  redirect("/account");
}
