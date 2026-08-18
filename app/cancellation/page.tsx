import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Cancellation policy",
  description: "Clearstep workshop cancellation, transfer, credit, and organiser-cancellation policy.",
  alternates: { canonical: "/cancellation" },
};

export default function CancellationPage() {
  return (
    <LegalPage eyebrow="Changes of plan" title="Cancellation policy">
      <section>
        <h2>Cancel at least 7 days before</h2>
        <p>Contact us at least seven calendar days before the workshop starts for a refund to the original payment method. Payment-provider processing time may affect when the refund appears.</p>
      </section>
      <section>
        <h2>Cancel within 7 days</h2>
        <p>Because places are limited and preparation has begun, late cancellations are normally offered a transfer to another person or a credit toward a future public workshop rather than a cash refund. Contact us as soon as possible so we can help.</p>
      </section>
      <section>
        <h2>Transfer your place</h2>
        <p>You may usually transfer a public-workshop place to another person at no charge. Send their name and email address before the session so we can update enrollment and joining information.</p>
      </section>
      <section>
        <h2>If Clearstep cancels</h2>
        <p>If we cancel a workshop, you may choose a full refund or move your booking to a suitable future session. Clearstep is not responsible for separate travel, accommodation, or other costs unless required by law.</p>
      </section>
      <section>
        <h2>How to request a change</h2>
        <p>Email <a href="mailto:brian@bncconsulting.co">brian@bncconsulting.co</a> from the address used for booking. Include the workshop, attendee name, and whether you are requesting cancellation, transfer, or credit.</p>
      </section>
    </LegalPage>
  );
}

