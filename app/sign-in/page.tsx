import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicPage } from "@/components/public-page";
import { SignInFormFromQuery } from "@/components/query-routed-content";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in securely to manage your BNC Consulting bookings and service orders.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-2xl text-center">
          <p className="eyebrow">Your BNC account</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Sign in without another password.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg">Use Google or a secure link sent to your inbox. One account keeps Clearstep workshop bookings and Plate &amp; Post service orders together.</p>
        </div>
        <Suspense fallback={<p role="status">Loading sign-in…</p>}>
          <SignInFormFromQuery />
        </Suspense>
      </section>
    </PublicPage>
  );
}

