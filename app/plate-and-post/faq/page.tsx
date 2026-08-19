import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";
import { serializeJsonLd } from "@/lib/json-ld";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Plate & Post FAQ",
  description: "Answers about Plate & Post services, published package details, checkout, scheduling, and order support.",
  alternates: { canonical: "/plate-and-post/faq" },
};

const questions = [
  ["What does Plate & Post create?", "Plate & Post creates product photography and social media content, with a primary focus on food-related projects. Published services may cover still photography, video content, or a combination."],
  ["Where can I see current packages and prices?", "The services page shows only published packages that are ready to order. Each live package displays its current gross price and details; the final total is shown before payment."],
  ["Do I need an account to order?", "Yes. Plate & Post uses the shared BNC account so your payment and service order can be recorded securely and shown alongside any Clearstep workshop bookings."],
  ["When is the shoot scheduled?", "After payment is confirmed, Plate & Post follows up manually to arrange the brief and schedule. The checkout confirmation is not a shoot date."],
  ["What is included in a package?", "Use the published service detail page as the current source for its description and outcomes. If anything is unclear, ask before ordering rather than relying on a draft or older offer."],
  ["How do I request a change or cancellation?", "Sign in to your BNC account and submit a change or cancellation request for the service order. Requests are reviewed by a person; the cancellation policy explains the applicable process."],
] as const;

export default function PlateAndPostFaqPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <PublicPage brandKey="plateAndPost">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <PageIntro eyebrow="Plate & Post FAQ" title="Questions before you book Plate & Post.">
        <p className="m-0">Can&apos;t find your answer? Email <a className="text-link" href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>.</p>
      </PageIntro>

      <section className="shell max-w-4xl pb-8">
        <div className="grid gap-4">
          {questions.map(([question, answer]) => (
            <details className="group rounded-[22px] border border-[var(--color-border)] bg-[var(--color-card)] p-6 open:shadow-[var(--shadow-elevated)]" key={question}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-[var(--font-display)] text-xl font-bold marker:hidden">
                {question}<span className="text-2xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mb-0 mt-4 pr-8">{answer}</p>
            </details>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-5">
          <Link className="button button-primary" href="/plate-and-post/services">View published services</Link>
          <Link className="text-link self-center" href="/cancellation">Read the cancellation policy</Link>
        </div>
      </section>
    </PublicPage>
  );
}
