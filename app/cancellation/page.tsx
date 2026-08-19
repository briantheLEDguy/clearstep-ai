import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Cancellation policy",
  description: "BNC Consulting cancellation and change-request policy for Clearstep AI and Plate & Post services.",
  alternates: { canonical: "/cancellation" },
};

export default function CancellationPage() {
  return (
    <LegalPage eyebrow="Changes of plan" document="cancellation">
      <section>
        <h2>Ask us to review a change</h2>
        <p>Use the authenticated request centre in your account to ask for a cancellation, transfer, reschedule, credit, or refund review. We will record the date of your request and review the purchase, the applicable service terms, work already performed or committed, and any statutory rights before confirming an outcome.</p>
      </section>
      <section>
        <h2>What happens after you ask</h2>
        <p>A staff member reviews each request manually. A request does not automatically cancel a booking or create a refund. Where a refund is approved, it is returned through the original payment method and provider timing may affect when it appears.</p>
      </section>
      <section>
        <h2>Clearstep AI transfers</h2>
        <p>You can ask for a transfer to another person through the authenticated request centre. We will review the booking and the applicable policy before confirming whether a transfer can be made.</p>
      </section>
      <section>
        <h2>If Clearstep cancels</h2>
        <p>If we cancel a workshop, you may choose a full refund or move your booking to a suitable future session. Clearstep is not responsible for separate travel, accommodation, or other costs unless required by law.</p>
      </section>
      <section>
        <h2>Plate &amp; Post scheduling</h2>
        <p>Payment does not reserve a particular shoot date. Staff contact you after payment to agree scheduling. Public purchase remains disabled until each package states its approved rescheduling, cancellation, revision, travel, and product-handling terms. Those package-specific terms will be shown before checkout and reviewed with any change request.</p>
      </section>
      <section>
        <h2>If Plate &amp; Post cancels</h2>
        <p>If we cannot provide a paid Plate &amp; Post service, we will offer a suitable alternative date or review a refund through the original payment method. Any separate customer costs are handled according to the agreed package terms and applicable law.</p>
      </section>
      <section>
        <h2>How to request a change</h2>
        <p><a href="/account">Sign in to your account</a> and submit a cancellation or change request for the relevant booking or service order. If you cannot access your account, email <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a> from the address used for purchase.</p>
      </section>
      <section>
        <h2>Complaints</h2>
        <p>If you are unhappy with how we handled a request, follow our <a href="/complaints">complaints procedure</a>.</p>
      </section>
    </LegalPage>
  );
}

