import type { Metadata } from "next";
import { CompanyContactDetails } from "@/components/company-contact-details";
import { LegalPage } from "@/components/legal-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Complaints procedure",
  description: "How to send BNC Consulting a complaint about Clearstep AI or Plate & Post.",
  alternates: { canonical: "/complaints" },
};

export default function ComplaintsPage() {
  return (
    <LegalPage eyebrow="We want to put things right" title="Complaints procedure">
      <section>
        <h2>How to make a complaint</h2>
        <ol>
          <li>Email <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a> or call <a href={`tel:${COMPANY_DETAILS.phoneHref}`}>{COMPANY_DETAILS.phone}</a>.</li>
          <li>Tell us what happened and, if relevant, include your workshop date, service order, or purchase reference.</li>
          <li>We will acknowledge your complaint and aim to give a substantive response within 14 days. If we need longer, we will explain why and tell you when to expect an update.</li>
        </ol>
        <p>For a workshop booking or Plate &amp; Post service cancellation or change, use the request centre in <a href="/account">your account</a> where possible so we can link it to the correct purchase.</p>
      </section>
      <CompanyContactDetails />
    </LegalPage>
  );
}
