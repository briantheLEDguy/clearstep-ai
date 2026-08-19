import { COMPANY_DETAILS } from "@/shared/company-details";

export function CompanyContactDetails({ heading = "Company and contact" }: { heading?: string }) {
  return (
    <section>
      <h2>{heading}</h2>
      <p>
        <strong>{COMPANY_DETAILS.name}</strong><br />
        {COMPANY_DETAILS.location}<br />
        KVK: {COMPANY_DETAILS.chamberOfCommerceNumber}<br />
        VAT ID: {COMPANY_DETAILS.vatId}
      </p>
      <p>
        Phone: <a href={`tel:${COMPANY_DETAILS.phoneHref}`}>{COMPANY_DETAILS.phone}</a><br />
        Email: <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>
      </p>
    </section>
  );
}
