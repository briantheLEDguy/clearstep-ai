import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: { absolute: "BNC Consulting | Clearstep AI and Plate & Post" },
  description: "Explore Clearstep AI workshops and Plate & Post product photography and social content services.",
  alternates: { canonical: "/" },
};

export default function BncConsultingHome() {
  return (
    <PublicPage brandKey="bnc">
      <section className="bnc-hero shell">
        <p className="eyebrow">BNC Consulting</p>
        <h1>One business.<br />Two focused service lines.</h1>
        <p className="bnc-hero-lede">Practical AI education and food-first content services.</p>
        <a className="button button-primary w-fit" href="#services">Explore our services</a>
      </section>

      <section className="shell pb-10 pt-6 md:pb-20" id="services" aria-labelledby="services-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Services</p>
            <h2 id="services-heading">Specialist help, under one roof.</h2>
          </div>
        </div>
        <div className="service-line-grid">
          <article className="service-line-card service-line-card-clearstep">
            <p className="card-eyebrow">Practical AI workshops</p>
            <h2>Clearstep AI</h2>
            <p className="mt-5 text-lg text-[var(--color-text-muted)]">
              Welcoming, hands-on workshops that turn everyday work into clear, repeatable AI workflows.
            </p>
            <Link className="button button-primary relative z-10" href="/clearstep">Explore Clearstep AI</Link>
          </article>
          <article className="service-line-card service-line-card-plate">
            <p className="card-eyebrow">Photography + social content</p>
            <h2>Plate &amp; Post</h2>
            <p className="mt-5 text-lg text-[var(--color-text-muted)]">
              Product photography and social content made for food-first brands that need every asset to work harder.
            </p>
            <Link className="button button-primary relative z-10" href="/plate-and-post">Explore Plate &amp; Post</Link>
          </article>
        </div>
      </section>

      <section className="shell py-16 md:py-24" aria-labelledby="bnc-contact-heading">
        <div className="grid gap-7 rounded-[30px] bg-white p-8 shadow-[var(--shadow-elevated)] md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div>
            <p className="eyebrow">Not sure where to start?</p>
            <h2 id="bnc-contact-heading" className="max-w-3xl">Tell us what you need to move forward.</h2>
          </div>
          <a className="button button-primary" href={`mailto:${COMPANY_DETAILS.email}`}>Contact BNC Consulting</a>
        </div>
      </section>
    </PublicPage>
  );
}
