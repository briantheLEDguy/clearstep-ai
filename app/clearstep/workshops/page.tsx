import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { PublicPage } from "@/components/public-page";
import { WorkshopCard } from "@/components/workshop-card";
import { getWorkshopCatalog } from "@/lib/workshops";

export const metadata: Metadata = {
  title: "Practical AI workshops",
  description: "Find a welcoming, hands-on Clearstep AI workshop in Amsterdam, Utrecht, or live online.",
  alternates: { canonical: "/clearstep/workshops" },
  openGraph: {
    title: "Practical AI workshops | Clearstep AI",
    description: "Small groups, useful methods, and real workflows you can use right away.",
    url: "/clearstep/workshops",
  },
};

export default async function WorkshopsPage() {
  const catalog = await getWorkshopCatalog();

  return (
    <PublicPage brandKey="clearstep">
      <PageIntro eyebrow="Upcoming sessions" title="Choose a workshop that starts with real work.">
        <p className="m-0">
          Every Clearstep workshop is practical, small-group, and designed for people who want AI to feel more useful—not more complicated.
        </p>
      </PageIntro>
      <section className="bg-[var(--navy)] py-16 text-[var(--cream)] md:py-24" aria-labelledby="upcoming-workshops">
        <div className="shell">
          <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-[var(--mint)]!">Book your place</p>
              <h2 id="upcoming-workshops" className="text-4xl md:text-5xl">Upcoming workshops</h2>
            </div>
            <p className="m-0 max-w-md text-base text-white/70">Times are shown in Europe/Amsterdam. Online joining details arrive after booking.</p>
          </div>
          {catalog.status === "ready" ? (
            <div className="workshop-grid">
              {catalog.workshops.map((workshop) => <WorkshopCard key={workshop.sessionId} workshop={workshop} />)}
            </div>
          ) : (
            <div className="rounded-[26px] border border-white/15 bg-white/10 p-7 md:p-9" role="status">
              <h3 className="text-2xl">
                {catalog.status === "empty" ? "New public dates are being prepared." : "The workshop calendar is temporarily unavailable."}
              </h3>
              <p className="mb-0 mt-3 max-w-2xl text-white/75">
                We are not showing placeholder dates or availability. Please check back shortly, or ask about a private workshop for your team.
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="shell grid gap-7 py-16 md:grid-cols-3 md:py-24" aria-label="What to expect">
        {[
          ["Bring a real task", "You will work on something useful from your own week, not a made-up exercise."],
          ["Practice with support", "Try the method, ask questions, and improve your workflow while help is in the room."],
          ["Leave with a next step", "Take away a result, a reusable method, and a simple plan for continuing."],
        ].map(([title, detail], index) => (
          <article className="rounded-[26px] border border-[var(--border)] bg-white p-7" key={title}>
            <span className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[var(--yellow)] font-[var(--font-manrope)] text-sm font-extrabold">0{index + 1}</span>
            <h2 className="text-2xl">{title}</h2>
            <p className="mb-0 mt-3">{detail}</p>
          </article>
        ))}
      </section>
    </PublicPage>
  );
}
