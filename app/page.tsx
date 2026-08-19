import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { WorkshopCard } from "@/components/workshop-card";
import { getWorkshopCatalog } from "@/lib/workshops";

export const metadata: Metadata = {
  title: { absolute: "Practical AI workshops for small businesses | Clearstep AI" },
  description:
    "Clearstep AI offers welcoming, hands-on workshops that turn everyday work into clear, repeatable AI workflows.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const catalog = await getWorkshopCatalog();

  return (
    <PublicPage>
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">Practical AI workshops</p>
          <h1>Make AI useful.<br />Keep it simple.</h1>
          <p className="hero-lede">
            Clear, hands-on workshops for freelancers and small-business owners.
            No jargon, no overwhelm—just guided practice you can use today.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/workshops">Find a workshop</Link>
            <Link className="text-link" href="/private-workshops">Plan a private session <span aria-hidden="true">→</span></Link>
          </div>
          <ul className="trust-list" aria-label="Workshop benefits">
            <li>No technical experience needed</li>
            <li>Build a real workflow</li>
            <li>Small groups, useful results</li>
          </ul>
        </div>

        <div className="hero-visual" aria-label="Three clear steps from an idea to a useful result">
          <div className="step-card step-one"><span>1</span><strong>Start with your work</strong></div>
          <div className="step-card step-two"><span>2</span><strong>Try a clear method</strong></div>
          <div className="step-card step-three"><span>3</span><strong>Leave with a result</strong></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="clear-path" src="/clear-path.png" alt="" width="200" height="136" />
        </div>
      </section>

      <section className="workshop-preview">
        <div className="shell">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Choose your next clear step</p>
              <h2>Upcoming workshops</h2>
            </div>
            <Link className="text-link" href="/workshops">See all workshops <span aria-hidden="true">→</span></Link>
          </div>
          {catalog.status === "ready" ? (
            <div className="workshop-grid">
              {catalog.workshops.slice(0, 2).map((workshop) => (
                <WorkshopCard headingLevel="h3" key={workshop.sessionId} workshop={workshop} />
              ))}
            </div>
          ) : (
            <div className="empty-state rounded-[24px] border border-[var(--border)] bg-white p-7 md:p-8" role="status">
              <h3 className="text-2xl">
                {catalog.status === "empty" ? "New workshop dates are on the way." : "Workshop dates are being updated."}
              </h3>
              <p className="mb-0 mt-3 max-w-2xl">
                There are no public sessions to show right now. You can still plan a practical private workshop shaped around your team.
              </p>
              <Link className="text-link mt-5 inline-block" href="/private-workshops">Plan a private session <span aria-hidden="true">→</span></Link>
            </div>
          )}
        </div>
      </section>
    </PublicPage>
  );
}
