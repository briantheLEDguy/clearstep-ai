import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";
import { COMPANY_DETAILS } from "@/shared/company-details";

export const metadata: Metadata = {
  title: "Workshop FAQ",
  description: "Answers about Clearstep AI workshop experience, preparation, booking, payment, accessibility, and cancellations.",
  alternates: { canonical: "/faq" },
};

const questions = [
  ["Do I need technical or AI experience?", "No. Workshops are designed for people who use everyday business tools and want a clear, practical introduction. We explain each step in plain language."],
  ["What should I bring?", "Bring a laptop, access to an AI tool you are comfortable using, and one real task or example from your work. We will tell you about any session-specific preparation by email."],
  ["Are the workshops recorded?", "Public live workshops are designed for active participation and are not recorded by default. If a specific online session will be recorded, that will be stated clearly before booking."],
  ["How large are the groups?", "Public sessions are kept small—normally 10 to 14 people—so there is time to practice and ask questions."],
  ["When is my place confirmed?", "Your place is confirmed only after payment succeeds and Clearstep records your enrollment. We then send confirmation and joining or calendar details to the email address on your Clearstep account; the booking also appears in your account."],
  ["What if the workshop is full?", "Join the waitlist. When a place opens, the first eligible person receives a time-limited booking offer before we move to the next person."],
  ["Can I transfer my place?", "You may usually transfer a public-workshop place to another person at no charge. Contact us before the workshop with the new participant’s name and email address. See the cancellation policy for timing and refund information."],
  ["Can you run this for my team?", "Yes. Private workshops can use your team’s examples, goals, and preferred format. Visit the private workshops page to start a conversation."],
  ["What about accessibility or dietary needs?", "Contact us as early as possible—ideally before booking—with the practical adjustment you need. We will discuss venue access, online participation, or dietary arrangements and confirm what we can provide before you pay. Please share only the information needed to make the arrangement."],
];

export default function FaqPage() {
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
    <PublicPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PageIntro eyebrow="Questions, answered" title="Everything you need before taking the next step.">
        <p className="m-0">Can’t find your answer? Email <a className="font-bold text-[var(--action)] underline" href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>.</p>
      </PageIntro>
      <section className="shell max-w-4xl pb-8">
        <div className="grid gap-4">
          {questions.map(([question, answer]) => (
            <details className="group rounded-[22px] border border-[var(--border)] bg-white p-6 open:shadow-[0_14px_35px_rgba(16,42,67,.08)]" key={question}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-[var(--font-manrope)] text-xl font-bold marker:hidden">
                {question}<span className="text-2xl text-[var(--action)] transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mb-0 mt-4 pr-8">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </PublicPage>
  );
}

