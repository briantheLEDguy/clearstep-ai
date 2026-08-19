import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";
import { ServicePackageCard } from "@/components/service-package-card";
import { getPlatePostServiceCatalog } from "@/lib/services";

export const metadata: Metadata = {
  title: "Photography and content packages",
  description: "Explore published Plate & Post product photography, video content, and combined packages.",
  alternates: { canonical: "/plate-and-post/services" },
  openGraph: {
    title: "Photography and content packages | Plate & Post",
    description: "Food-first product photography and social content packages.",
    url: "/plate-and-post/services",
  },
};

export default async function PlateAndPostServicesPage() {
  const catalog = await getPlatePostServiceCatalog();

  return (
    <PublicPage brandKey="plateAndPost">
      <PageIntro eyebrow="Plate & Post services" title="Choose the content package your brand needs.">
        <p className="m-0">Start with stills, motion, or a combined shoot. Published packages show the current price and open the same secure checkout used across BNC Consulting.</p>
      </PageIntro>
      <section className="shell pb-16 md:pb-24" aria-label="Available Plate and Post packages">
        {catalog.status === "ready" ? (
          <div className="service-package-grid">
            {catalog.services.map((service) => <ServicePackageCard key={service.catalogItemId} service={service} />)}
          </div>
        ) : (
          <div className="rounded-[28px] border border-[var(--color-border)] bg-white p-8 shadow-[var(--shadow-elevated)]" role="status">
            <p className="eyebrow">Live catalogue</p>
            <h2 className="text-3xl">
              {catalog.status === "empty" ? "Package booking is not open yet." : "Package pricing is temporarily unavailable."}
            </h2>
            <p className="mb-0 mt-4 max-w-2xl">
              We do not show draft offers or placeholder prices. Please check back when the published catalogue is available.
            </p>
          </div>
        )}
      </section>
    </PublicPage>
  );
}
