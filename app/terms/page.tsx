import type { Metadata } from "next";
import { CompanyContactDetails } from "@/components/company-contact-details";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "Terms for using BNC Consulting websites, accounts, Clearstep workshops, and Plate & Post services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Using BNC Consulting services" document="terms">
      <CompanyContactDetails />
      <section>
        <h2>Agreement</h2>
        <p>These terms apply to BNC Consulting B.V. and its Clearstep AI and Plate &amp; Post service lines. Before starting payment, you must actively acknowledge the current Terms of service and Cancellation policy. We record that acknowledgement with the checkout attempt. If you order for someone else or an organisation, you confirm that you are authorised to provide their details and accept the applicable terms.</p>
      </section>
      <section>
        <h2>Accounts</h2>
        <p>Use an email address you control and keep access to your sign-in method secure. You are responsible for activity on your account and should tell us promptly if you believe it has been used without permission.</p>
      </section>
      <section>
        <h2>Prices and payment</h2>
        <p>An order is confirmed only when payment succeeds and BNC Consulting records the purchase. A checkout page, pending seat hold, draft service order, or waitlist entry is not a confirmed purchase. The gross price, currency, and applicable tax treatment are shown before you pay.</p>
      </section>
      <section>
        <h2>Clearstep AI workshops</h2>
        <p>A workshop place is confirmed only after payment and enrollment. Clearstep may make reasonable changes to timing, venue, facilitator, examples, or format. If a material change prevents you from attending, we will offer a suitable alternative or apply the Cancellation policy.</p>
      </section>
      <section>
        <h2>Plate &amp; Post service orders</h2>
        <p>Plate &amp; Post provides product photography, styling, video, and social-content services. After payment, staff contact you to agree scheduling and the practical next steps. Payment alone does not reserve a particular date. Only published offerings with approved deliverables, turnaround, revision limits, travel and product-handling terms, and image or video usage rights may be purchased publicly.</p>
      </section>
      <section>
        <h2>Changes to services</h2>
        <p>We may make reasonable operational changes that do not materially reduce the purchased service. If BNC Consulting needs to make a material change, we will explain the change and offer an appropriate alternative or review a refund under the Cancellation policy and applicable law.</p>
      </section>
      <section>
        <h2>Your responsibilities</h2>
        <p>For Clearstep, participate respectfully, follow reasonable venue or online instructions, and avoid sharing confidential, unlawful, or sensitive third-party information with AI tools. For Plate &amp; Post, provide products, packaging, brand assets, instructions, permissions, and approvals that you are entitled to supply. You remain responsible for your commercial decisions and for checking final approved materials before publication.</p>
      </section>
      <section>
        <h2>Materials and intellectual property</h2>
        <p>Clearstep workshop materials remain the property of Clearstep or their respective owners. A workshop booking gives you a personal, non-transferable right to use supplied materials in your own work. Plate &amp; Post ownership, licence, territory, duration, channels, and portfolio-use terms must be stated in the published offering or agreed order before purchase. Pre-existing BNC Consulting methods, templates, and brand assets remain ours or their respective owners&apos;.</p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>Clearstep workshops provide education and practical guidance, not legal, financial, security, or other regulated professional advice. Plate &amp; Post creative work does not guarantee a particular reach, sales result, or platform performance. Nothing in these terms excludes liability that cannot lawfully be excluded. Where permitted, BNC Consulting is not responsible for indirect loss or decisions made from AI output or unapproved use of creative materials.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions about these terms can be sent to <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>. For a service complaint, follow our <a href="/complaints">complaints procedure</a>.</p>
      </section>
    </LegalPage>
  );
}

