import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "About Clearstep",
  description: "Clearstep makes practical AI easier to understand, try, and use responsibly in everyday business work.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PublicPage>
      <PageIntro eyebrow="About Clearstep" title="AI should make the next step clearer—not create more noise.">
        <p className="m-0">Clearstep was created for people who are curious about AI but do not want hype, jargon, or a tool demo that disappears from memory the next day.</p>
      </PageIntro>
      <section className="bg-white py-16 md:py-24">
        <div className="shell grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="relative min-h-[380px] rounded-[32px] bg-[var(--mint)] p-8" aria-label="Clearstep method: start with work, try a method, leave with a result">
            {[
              ["01", "Start with your work", "bg-white -rotate-2"],
              ["02", "Try a clear method", "bg-[var(--yellow)] rotate-2"],
              ["03", "Leave with a result", "bg-[var(--navy)] text-white -rotate-1"],
            ].map(([number, text, style], index) => (
              <div className={`absolute left-[8%] flex w-[84%] items-center gap-4 rounded-2xl p-5 shadow-[var(--shadow)] ${style}`} style={{ top: `${38 + index * 112}px` }} key={text}>
                <span className="font-[var(--font-manrope)] text-sm font-extrabold">{number}</span><strong>{text}</strong>
              </div>
            ))}
          </div>
          <div>
            <p className="eyebrow">The approach</p>
            <h2 className="text-4xl md:text-5xl">Practical, human, and grounded in good judgment.</h2>
            <p className="mt-6 text-xl">A Clearstep workshop starts with a real task, introduces a method in plain language, and gives people enough guided practice to make it their own.</p>
            <p>AI is useful when people remain responsible for context, quality, privacy, and the final decision. Those checks are part of the workflow—not an afterthought.</p>
          </div>
        </div>
      </section>
      <section className="shell py-16 md:py-24">
        <p className="eyebrow">What Clearstep values</p>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ["Clarity over hype", "Useful explanations, honest limits, and no pressure to adopt a tool just because it is new."],
            ["Practice over presentation", "People learn by trying a method with their own work and getting useful feedback."],
            ["Judgment stays human", "AI can support the work. People remain accountable for what is shared, trusted, and used."],
          ].map(([title, detail]) => (
            <article className="rounded-[26px] border border-[var(--border)] bg-white p-7" key={title}><h2 className="text-2xl">{title}</h2><p className="mb-0 mt-4">{detail}</p></article>
          ))}
        </div>
      </section>
    </PublicPage>
  );
}

