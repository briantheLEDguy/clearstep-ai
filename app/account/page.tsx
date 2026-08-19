import type { Metadata } from "next";
import { AccountDashboard } from "@/components/account-dashboard";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Your account",
  description: "View your BNC Consulting workshop bookings, service orders, and account details.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <PublicPage>
      <section className="shell py-14 md:py-20">
        <div className="mb-9 max-w-3xl">
          <p className="eyebrow">Your account</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.5rem)] leading-[1.04]">Your bookings and service orders, all in one place.</h1>
        </div>
        <AccountDashboard />
      </section>
    </PublicPage>
  );
}

