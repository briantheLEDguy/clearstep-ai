import type { Metadata } from "next";
import { CompanyContactDetails } from "@/components/company-contact-details";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "Terms for using the Clearstep website, account, and workshop booking services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Using Clearstep" document="terms">
      <CompanyContactDetails />
      <section>
        <h2>Agreement</h2>
        <p>Before starting payment for a workshop, you must actively acknowledge the current Terms of service and Cancellation policy. We record that acknowledgement with the checkout attempt. If you book for someone else, you confirm that you are authorised to provide their details and accept the booking terms.</p>
      </section>
      <section>
        <h2>Accounts</h2>
        <p>Use an email address you control and keep access to your sign-in method secure. You are responsible for activity on your account and should tell us promptly if you believe it has been used without permission.</p>
      </section>
      <section>
        <h2>Bookings and payment</h2>
        <p>A place is confirmed only when payment succeeds and Clearstep records the enrollment. A checkout page, pending seat hold, or waitlist entry is not a confirmed booking. Prices and any applicable taxes are shown before you pay.</p>
      </section>
      <section>
        <h2>Workshop changes</h2>
        <p>We may make reasonable changes to timing, venue, facilitator, examples, or format. If a material change prevents you from attending, we will offer a suitable alternative or apply the cancellation policy.</p>
      </section>
      <section>
        <h2>Participation</h2>
        <p>Please participate respectfully, follow reasonable venue or online instructions, and avoid sharing confidential, unlawful, or sensitive third-party information with AI tools during exercises. You remain responsible for decisions and work produced using workshop methods.</p>
      </section>
      <section>
        <h2>Materials and intellectual property</h2>
        <p>Clearstep workshop materials remain the property of Clearstep or their respective owners. Your booking gives you a personal, non-transferable right to use supplied materials in your own work. Do not resell, publish, or distribute them without written permission.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>Workshops provide education and practical guidance, not legal, financial, security, or other regulated professional advice. Nothing in these terms excludes liability that cannot lawfully be excluded. Where permitted, Clearstep is not responsible for indirect loss or decisions made from AI output.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions about these terms can be sent to <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>. For a service complaint, follow our <a href="/complaints">complaints procedure</a>.</p>
      </section>
    </LegalPage>
  );
}

