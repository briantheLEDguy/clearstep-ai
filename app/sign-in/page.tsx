import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";
import { SignInForm } from "@/components/sign-in-form";
import { safeReturnPath } from "@/lib/supabase/redirects";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in securely to manage your Clearstep workshop bookings and joining details.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath = safeReturnPath(rawNext);

  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-2xl text-center">
          <p className="eyebrow">Your Clearstep account</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Sign in without another password.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg">Use Google or a secure link sent to your inbox. Your account keeps bookings and workshop details together.</p>
        </div>
        <SignInForm nextPath={nextPath} />
      </section>
    </PublicPage>
  );
}

