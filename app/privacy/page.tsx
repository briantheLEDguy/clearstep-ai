import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Clearstep collects, uses, stores, and protects personal information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Your information" title="Privacy policy">
      <section>
        <h2>In plain language</h2>
        <p>Clearstep collects only the information needed to run workshops, manage your account and booking, provide support, and improve the service. We do not sell personal information.</p>
      </section>
      <section>
        <h2>Information we collect</h2>
        <ul>
          <li>Account details such as your name, email address, and sign-in provider.</li>
          <li>Booking details, payment status, workshop attendance, waitlist status, and messages you send us.</li>
          <li>Payment references from our payment provider. Clearstep does not store full card details.</li>
          <li>Basic first-party usage events, such as pages viewed, checkout started, and booking completed.</li>
          <li>Technical information needed for security, fraud prevention, and reliable operation.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>We use information to create and secure accounts, process bookings, manage capacity and waitlists, send joining information, provide workshops, respond to questions, keep records, understand basic website performance, and meet legal obligations.</p>
      </section>
      <section>
        <h2>Services that help us operate</h2>
        <p>Clearstep uses specialist providers for website hosting, authentication and database services, payment processing, and Google Workspace email and calendar automation. They receive only the information needed to provide their part of the service and process it under their own security and privacy terms.</p>
      </section>
      <section>
        <h2>Retention and security</h2>
        <p>We keep booking and financial records for as long as required for administration, tax, dispute handling, and legal obligations. Raw website analytics are kept only for a limited period and may then be retained as aggregated statistics. We use access controls, encryption in transit, and restricted administrative access.</p>
      </section>
      <section>
        <h2>Your choices and rights</h2>
        <p>You can ask to access, correct, or delete your information, or object to certain uses. Some information may need to be retained where the law or an active booking requires it. Contact <a href="mailto:brian@bncconsulting.co">brian@bncconsulting.co</a> with a privacy request.</p>
      </section>
      <section>
        <h2>Questions or complaints</h2>
        <p>Contact us first so we can help. Depending on where you live, you may also have the right to complain to your local data-protection authority.</p>
      </section>
    </LegalPage>
  );
}

