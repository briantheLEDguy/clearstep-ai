import Link from "next/link";
import { ServiceCheckout } from "@/components/service-checkout";
import { formatServiceDuration, formatServicePrice, type ServicePackage } from "@/lib/services";

export function ServicePackageCard({ service }: { service: ServicePackage }) {
  const duration = formatServiceDuration(service.durationMinutes);

  return (
    <article className="service-package-card">
      <p className="card-eyebrow">Plate &amp; Post package</p>
      <h3>{service.title}</h3>
      <p className="service-price">{formatServicePrice(service)}</p>
      <p className="m-0 text-sm text-[var(--color-text-muted)]">
        {duration ? `${duration}. ` : ""}Gross package price. The final total is shown before payment.
      </p>
      <p className="mt-5">{service.summary}</p>
      <Link className="card-link" href={`/plate-and-post/services/${service.slug}`}>View package details <span aria-hidden="true">→</span></Link>
      <ServiceCheckout compact serviceSlug={service.slug} serviceTitle={service.title} />
    </article>
  );
}
