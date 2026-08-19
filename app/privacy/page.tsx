import type { Metadata } from "next";
import { CompanyContactDetails } from "@/components/company-contact-details";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How BNC Consulting collects, uses, stores, and protects personal information across Clearstep AI and Plate & Post.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Your information" document="privacy">
      <CompanyContactDetails />
      <section>
        <h2>In plain language</h2>
        <p>BNC Consulting collects only the information needed to run Clearstep AI workshops, provide Plate &amp; Post services, manage your account and purchases, provide support, and improve the service. We do not sell personal information.</p>
      </section>
      <section>
        <h2>Information we collect</h2>
        <ul>
          <li>Account details such as your name, email address, and sign-in provider.</li>
          <li>Workshop bookings, service orders, payment and fulfilment status, attendance, waitlist status, scheduling details, and messages you send us.</li>
          <li>Payment references from our payment provider. BNC Consulting does not store full card details.</li>
          <li>Optional anonymous website insight only after you choose to allow it: page views, course views, and a limited campaign source.</li>
          <li>Technical information needed for security, fraud prevention, and reliable operation.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>We use information to create and secure accounts, process bookings and service orders, manage capacity, waitlists and manual scheduling, provide the purchased service, respond to questions, keep records, and meet legal obligations. Optional website insight is used only with your analytics consent and is not linked to your BNC Consulting account.</p>
      </section>
      <section>
        <h2>Services that help us operate</h2>
        <p>BNC Consulting uses specialist providers for website hosting, authentication and database services, payment processing, and Google Workspace email and calendar automation. They receive only the information needed to provide their part of the service and process it under their own security and privacy terms.</p>
      </section>
      <section>
        <h2>Retention and security</h2>
        <p>Raw consented website analytics are retained for 30 days and then only aggregate insight is retained for up to 12 months. Booking and financial records may be retained where needed for administration, tax, dispute handling, and legal obligations. We use access controls, encryption in transit, and restricted administrative access.</p>
      </section>
      <section>
        <h2>Your choices and rights</h2>
        <p>You can ask to access, correct, erase, restrict, or object to certain uses of your information. Some information may need to be retained where the law or an active booking requires it. Submit an authenticated request in <a href="/account">your account</a> or contact <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>. You can change or withdraw analytics consent at any time through Privacy choices in the site footer.</p>
      </section>
      <section>
        <h2>Questions or complaints</h2>
        <p>For a service complaint, use our <a href="/complaints">complaints procedure</a>. For a privacy concern, contact us first so we can help. If you are in the Netherlands, you may complain to the <a href="https://autoriteitpersoonsgegevens.nl/en">Dutch Data Protection Authority</a>; you may also contact your local data-protection authority.</p>
      </section>
    </LegalPage>
  );
}

