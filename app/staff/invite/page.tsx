import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";
import { StaffInviteAcceptance } from "@/components/staff-invite-acceptance";

export const metadata: Metadata = {
  title: "Accept staff invitation",
  description: "Accept a private invitation to the Clearstep staff workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function StaffInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = rawToken && rawToken.length >= 32 && rawToken.length <= 200 ? rawToken : undefined;
  const returnPath = token ? `/staff/invite?token=${encodeURIComponent(token)}` : "/staff/invite";

  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <p className="eyebrow">Clearstep staff</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Accept your workspace invitation.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg">Sign in with the verified email address that received the invitation. The invitation service checks the match before granting access.</p>
        </div>
        <StaffInviteAcceptance token={token} returnPath={returnPath} />
      </section>
    </PublicPage>
  );
}
