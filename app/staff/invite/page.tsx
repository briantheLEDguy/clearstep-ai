import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicPage } from "@/components/public-page";
import { StaffInviteAcceptanceFromQuery } from "@/components/query-routed-content";

export const metadata: Metadata = {
  title: "Accept staff invitation",
  description: "Accept a private invitation to the Clearstep staff workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default function StaffInvitePage() {
  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <p className="eyebrow">Clearstep staff</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Accept your workspace invitation.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg">Sign in with the verified email address that received the invitation. The invitation service checks the match before granting access.</p>
        </div>
        <Suspense fallback={<p role="status">Loading your invitation…</p>}>
          <StaffInviteAcceptanceFromQuery />
        </Suspense>
      </section>
    </PublicPage>
  );
}
