import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { ServicePackageCard } from "@/components/service-package-card";
import { getPlatePostServiceCatalog } from "@/lib/services";

export const metadata: Metadata = {
  title: { absolute: "Plate & Post | Product photography and social content" },
  description: "Product photography and social content made for food-first brands. Styled with purpose, shot with appetite, and planned to stay useful.",
  alternates: { canonical: "/plate-and-post" },
};

const serviceCategories = [
  ["Product photography", "A focused product shoot built around true colour, believable texture, and a clear hero."],
  ["Video content", "Short-form motion content planned for the formats and channels where your audience will see it."],
  ["Photo + video", "A combined content library for brands that need flexible stills and motion from one brief."],
] as const;

export default async function PlateAndPostHome() {
  const catalog = await getPlatePostServiceCatalog();

  return (
    <PublicPage brandKey="plateAndPost">
      <section className="plate-post-hero shell">
        <div>
          <p className="eyebrow">Product photography + social content</p>
          <h1>Content made to be craved.</h1>
          <p className="hero-lede">
            Plate &amp; Post creates appetite-led product photography and social content for food-first brands—then plans every asset around the commercial job it needs to do.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/plate-and-post/services">Explore packages</Link>
            <a className="text-link" href="#process">See how it works <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="plate-post-still-life" aria-hidden="true"><span>Styled.<br />Shot.<br />Shared.</span></div>
      </section>

      <section className="bg-[var(--color-surface-strong)] py-16 text-[var(--color-on-strong)] md:py-24" aria-labelledby="plate-services-heading">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="eyebrow text-[var(--color-surface-soft)]!">Services</p>
              <h2 id="plate-services-heading">A focused package for the content you need now.</h2>
            </div>
            <Link className="text-link text-[var(--color-surface-soft)]!" href="/plate-and-post/services">See all services <span aria-hidden="true">→</span></Link>
          </div>
          {catalog.status === "ready" ? (
            <div className="service-package-grid text-[var(--color-text)]">
              {catalog.services.map((service) => <ServicePackageCard key={service.catalogItemId} service={service} />)}
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-3" role="status">
              {serviceCategories.map(([title, detail]) => (
                <article className="rounded-[26px] bg-[var(--color-surface)] p-7 text-[var(--color-text)]" key={title}>
                  <h3>{title}</h3><p className="mb-0 mt-4">{detail}</p>
                </article>
              ))}
              <p className="m-0 md:col-span-3 text-white/75">
                {catalog.status === "empty" ? "Package booking will open when the first services are published." : "Live package pricing is temporarily unavailable. No placeholder prices are shown."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="shell py-16 md:py-24" id="process" aria-labelledby="process-heading">
        <p className="eyebrow">The Plate &amp; Post approach</p>
        <h2 id="process-heading" className="max-w-3xl">Appetite gets attention. Strategy makes it useful.</h2>
        <div className="plate-process-grid mt-10">
          {[
            ["01", "Style with purpose", "Every prop, surface, and crop supports the product and the brief."],
            ["02", "Shoot with appetite", "True colour, believable texture, and a clear hero make the first bite visual."],
            ["03", "Post with strategy", "Each shoot becomes a flexible library built for campaigns, feeds, and reuse."],
          ].map(([number, title, detail]) => (
            <article className="plate-process-card" key={number}>
              <span>{number}</span><h3 className="mt-3">{title}</h3><p className="mb-0 mt-3">{detail}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicPage>
  );
}
