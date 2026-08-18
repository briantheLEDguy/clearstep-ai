import type { Metadata } from "next";
import { Suspense } from "react";
import { LegacyBookingRedirect } from "@/components/query-routed-content";

export const metadata: Metadata = {
  title: "Booking confirmation",
  robots: { index: false, follow: false, nocache: true },
};

export default function LegacyBookingResultPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--cream)] px-5 py-12">
      <Suspense fallback={<p role="status">Loading your booking…</p>}>
        <LegacyBookingRedirect />
      </Suspense>
    </main>
  );
}
