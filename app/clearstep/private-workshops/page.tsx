import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PrivateWorkshopRequestForm } from "@/components/private-workshop-request-form";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Private AI workshops for teams",
  description: "Plan a practical Clearstep AI workshop around your team’s real work, questions, and goals.",
  alternates: { canonical: "/clearstep/private-workshops" },
};

export default function PrivateWorkshopsPage() {
  return (
    <PublicPage brandKey="clearstep">
      <PageIntro eyebrow="For teams" title="A practical AI workshop shaped around your work.">
        <p className="m-0">Bring the team, the recurring tasks, and the questions. Clearstep turns them into a focused session with examples your people recognize and methods they can reuse.</p>
        <a className="button button-primary mt-8" href="#private-workshop-request">Tell us about your team</a>
      </PageIntro>
      <section className="bg-[var(--navy)] py-16 text-[var(--cream)] md:py-24">
        <div className="shell">
          <p className="eyebrow text-[var(--mint)]!">What can be tailored</p>
          <h2 className="max-w-3xl text-4xl md:text-5xl">Start with the outcomes your team needs.</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ["Everyday AI confidence", "A shared foundation for prompting, reviewing output, and knowing when not to use AI."],
              ["Content and communication", "Clearer briefs, drafts, client updates, and repeatable ways to protect the team’s voice."],
              ["Operations and admin", "Map recurring work and build practical workflows with human checks in the right places."],
            ].map(([title, detail]) => (
              <article className="rounded-[26px] bg-[var(--cream)] p-7 text-[var(--navy)]" key={title}>
                <h3 className="text-2xl">{title}</h3><p className="mb-0 mt-4">{detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="shell grid gap-12 py-16 lg:grid-cols-[.9fr_1.1fr] md:py-24">
        <div><p className="eyebrow">A simple process</p><h2 className="text-4xl md:text-5xl">Clear before, practical during, useful after.</h2></div>
        <ol className="grid list-none gap-5 p-0">
          {[
            ["Brief conversation", "Share the team, current experience, goals, and the work you want to improve."],
            ["Focused session design", "Clearstep prepares relevant examples and a hands-on flow for your group."],
            ["Workshop and follow-through", "The team practices together and leaves with shared methods and next steps."],
          ].map(([title, detail], index) => (
            <li className="grid grid-cols-[52px_1fr] gap-5 rounded-[24px] border border-[var(--border)] bg-white p-6" key={title}>
              <span className="grid h-12 place-items-center rounded-xl bg-[var(--yellow)] font-bold">0{index + 1}</span>
              <div><h3 className="text-2xl">{title}</h3><p className="mb-0 mt-2">{detail}</p></div>
            </li>
          ))}
        </ol>
      </section>
      <section id="private-workshop-request" className="shell scroll-mt-8 rounded-[30px] bg-[var(--mint)] p-6 text-center md:p-14" aria-labelledby="private-workshop-request-title">
        <p className="eyebrow">Plan your session</p>
        <h2 id="private-workshop-request-title" className="mx-auto max-w-3xl text-4xl md:text-5xl">Tell us what would make the workshop worthwhile.</h2>
        <p className="mx-auto mt-5 max-w-2xl">We’ll reply with a clear recommendation for format, length, and next steps. No complicated proposal process.</p>
        <div className="mx-auto mt-9 max-w-4xl">
          <PrivateWorkshopRequestForm />
        </div>
      </section>
    </PublicPage>
  );
}
