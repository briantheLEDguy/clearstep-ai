import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "About Plate & Post",
  description: "Plate & Post is BNC Consulting's product photography and social content service, with a focus on food-related projects.",
  alternates: { canonical: "/plate-and-post/about" },
};

const principles = [
  ["Photography and motion", "Product photography and short-form video can stand alone or work together as one content library."],
  ["Food-first focus", "Food-related products and projects are at the centre of the service, from the styling through to the final crop."],
  ["One BNC account", "Plate & Post orders use the same secure BNC account, checkout, and customer-support flow as Clearstep AI."],
] as const;

export default function PlateAndPostAboutPage() {
  return (
    <PublicPage brandKey="plateAndPost">
      <PageIntro eyebrow="About Plate & Post" title="Product content with a food-first point of view.">
        <p className="m-0">Plate &amp; Post is BNC Consulting&apos;s product photography and social media content service. Its work is primarily food related, with each brief shaped around the product and the assets a client needs to publish.</p>
      </PageIntro>

      <section className="bg-[var(--color-surface-strong)] py-16 text-[var(--color-on-strong)] md:py-24" aria-labelledby="plate-about-heading">
        <div className="shell">
          <p className="eyebrow text-[var(--color-surface-soft)]!">What guides the work</p>
          <h2 id="plate-about-heading" className="max-w-3xl">Useful content starts with a clear job.</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {principles.map(([title, detail]) => (
              <article className="rounded-[26px] bg-[var(--color-surface)] p-7 text-[var(--color-text)]" key={title}>
                <h3>{title}</h3>
                <p className="mb-0 mt-4">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shell grid gap-8 py-16 md:grid-cols-[1fr_auto] md:items-center md:py-24" aria-labelledby="plate-about-booking-heading">
        <div>
          <p className="eyebrow">Booking Plate &amp; Post</p>
          <h2 id="plate-about-booking-heading" className="max-w-3xl">Published packages show what is ready to order.</h2>
          <p className="mb-0 mt-5 max-w-3xl">Choose a live service, review its current gross price and details, and continue through secure checkout. After confirmed payment, Plate &amp; Post follows up to arrange the brief and schedule.</p>
        </div>
        <Link className="button button-primary" href="/plate-and-post/services">View services</Link>
      </section>
    </PublicPage>
  );
}
