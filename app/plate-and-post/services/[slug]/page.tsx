import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPage } from "@/components/public-page";
import { ServiceCheckout } from "@/components/service-checkout";
import { StaffServicePreview } from "@/components/staff-service-preview";
import { serializeJsonLd } from "@/lib/json-ld";
import { getSiteOrigin } from "@/lib/site-origin";
import {
  formatServiceDuration,
  formatServicePrice,
  getPlatePostService,
  isPlatePostServiceSlug,
  PLATE_POST_SERVICE_SLUGS,
} from "@/lib/services";

type ServicePageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return PLATE_POST_SERVICE_SLUGS.map((slug) => ({ slug }));
}

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isPlatePostServiceSlug(slug)) return { title: "Service not found", robots: { index: false, follow: false } };
  const { catalogStatus, service } = await getPlatePostService(slug);
  if (!service) {
    return {
      title: "Package not currently available",
      description: "This Plate & Post package is not currently published for booking.",
      robots: { index: false, follow: catalogStatus !== "empty" },
    };
  }
  const url = `/plate-and-post/services/${service.slug}`;
  return {
    title: service.seoTitle,
    description: service.seoDescription,
    alternates: { canonical: url },
    openGraph: { title: service.seoTitle, description: service.seoDescription, url },
  };
}

export default async function PlateAndPostServiceDetailPage({ params }: ServicePageProps) {
  const { slug } = await params;
  if (!isPlatePostServiceSlug(slug)) notFound();
  const { catalogStatus, service } = await getPlatePostService(slug);

  if (!service) {
    return (
      <PublicPage brandKey="plateAndPost">
        <section className="shell py-16 md:py-24" role="status">
          <Link className="text-link" href="/plate-and-post/services">← All services</Link>
          <p className="eyebrow mt-10">Plate &amp; Post package</p>
          <h1 className="max-w-3xl">This package is not available to book yet.</h1>
          <p className="mt-6 max-w-2xl text-xl">
            {catalogStatus === "empty" ? "It has not been published to the live catalogue." : "We cannot load verified package details or pricing right now."}
          </p>
          <p className="max-w-2xl">No draft price or placeholder availability is shown. Return to the service overview to see any published packages.</p>
          <Link className="button button-primary mt-6" href="/plate-and-post/services">View published services</Link>
          <StaffServicePreview serviceSlug={slug} />
        </section>
      </PublicPage>
    );
  }

  const origin = getSiteOrigin();
  const serviceUrl = `${origin}/plate-and-post/services/${service.slug}`;
  const duration = formatServiceDuration(service.durationMinutes);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.title,
    description: service.summary,
    url: serviceUrl,
    provider: { "@type": "Organization", name: "BNC Consulting", url: origin },
    brand: { "@type": "Brand", name: "Plate & Post" },
    offers: {
      "@type": "Offer",
      price: (service.priceCents / 100).toFixed(2),
      priceCurrency: service.currency,
      url: serviceUrl,
    },
  };

  return (
    <PublicPage brandKey="plateAndPost">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <section className="shell py-12 md:py-20">
        <Link className="text-link" href="/plate-and-post/services">← All services</Link>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
          <div>
            <p className="eyebrow">Plate &amp; Post package</p>
            <h1 className="max-w-4xl text-[clamp(3rem,7vw,5.8rem)] leading-[.96]">{service.title}</h1>
            <p className="mt-7 max-w-3xl text-xl leading-relaxed">{service.description}</p>
            <dl className="mt-9 grid gap-4 rounded-[26px] bg-[var(--color-surface-soft)] p-6 sm:grid-cols-2 md:p-8">
              <div><dt className="text-sm font-bold uppercase tracking-[.08em]">Package price</dt><dd className="m-0 mt-1 font-[var(--font-display)] text-3xl font-bold">{formatServicePrice(service)}</dd></div>
              <div><dt className="text-sm font-bold uppercase tracking-[.08em]">Typical fit</dt><dd className="m-0 mt-1 font-bold">{duration ?? "Scoped to the brief"}</dd></div>
            </dl>
          </div>
          <aside className="rounded-[28px] bg-white p-7 shadow-[var(--shadow-elevated)] md:p-9" aria-label={`Book ${service.title}`}>
            <p className="eyebrow">Secure checkout</p>
            <h2 className="text-3xl">Ready to start?</h2>
            <p className="mb-0 mt-4">Gross package price. The final total is shown before payment.</p>
            <ServiceCheckout serviceSlug={service.slug} serviceTitle={service.title} />
          </aside>
        </div>
      </section>
      <section className="bg-white py-16 md:py-24">
        <div className="shell grid gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow">What this package delivers</p>
            <h2>Assets with a job to do.</h2>
            <ul className="service-outcomes mt-7">
              {service.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
            </ul>
          </div>
          <div className="rounded-[28px] bg-[var(--color-surface)] p-8">
            <p className="eyebrow">Who it is for</p>
            <h2 className="text-3xl">A useful fit for the right brief.</h2>
            <p className="mb-0 mt-5 text-lg">{service.audience}</p>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
