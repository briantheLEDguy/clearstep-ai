import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Cancellation policy",
  description: "Clearstep workshop cancellation, transfer, credit, and organiser-cancellation policy.",
  alternates: { canonical: "/cancellation" },
};

export default function CancellationPage() {
  return (
    <LegalPage eyebrow="Changes of plan" document="cancellation">
      <section>
        <h2>Ask us to review a change</h2>
        <p>Use the authenticated request centre in your account to ask for a cancellation, transfer, credit, or refund review. We will record the date of your request and review the booking, the applicable terms, and any statutory rights before confirming an outcome.</p>
      </section>
      <section>
        <h2>What happens after you ask</h2>
        <p>A staff member reviews each request manually. A request does not automatically cancel a booking or create a refund. Where a refund is approved, it is returned through the original payment method and provider timing may affect when it appears.</p>
      </section>
      <section>
        <h2>Transfer your place</h2>
        <p>You can ask for a transfer to another person through the authenticated request centre. We will review the booking and the applicable policy before confirming whether a transfer can be made.</p>
      </section>
      <section>
        <h2>If Clearstep cancels</h2>
        <p>If we cancel a workshop, you may choose a full refund or move your booking to a suitable future session. Clearstep is not responsible for separate travel, accommodation, or other costs unless required by law.</p>
      </section>
      <section>
        <h2>How to request a change</h2>
        <p><a href="/account">Sign in to your account</a> and submit a cancellation or booking-change request for the relevant workshop. If you cannot access your account, email <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a> from the address used for booking.</p>
      </section>
      <section>
        <h2>Complaints</h2>
        <p>If you are unhappy with how we handled a request, follow our <a href="/complaints">complaints procedure</a>.</p>
      </section>
    </LegalPage>
  );
}

