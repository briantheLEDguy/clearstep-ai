import Link from "next/link";
import { formatWorkshopAvailability, formatWorkshopDate, formatWorkshopLocation, type Workshop, workshopRouteSegment } from "@/lib/workshops";

export function WorkshopCard({ workshop, headingLevel = "h2" }: { workshop: Workshop; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;

  return (
    <article className="workshop-card border border-[var(--border)] shadow-[0_18px_45px_rgba(16,42,67,.08)]">
      <p className="card-eyebrow">{workshop.eyebrow}</p>
      <Heading className="text-[2rem] leading-tight">{workshop.title}</Heading>
      <p>{workshop.summary}</p>
      <div className="workshop-meta">
        <span>{formatWorkshopDate(workshop)}</span>
        <span>{formatWorkshopLocation(workshop)}</span>
        <strong>{formatWorkshopAvailability(workshop)}</strong>
      </div>
      <div className="mt-6 flex items-center justify-between gap-4">
        <strong className="font-[var(--font-manrope)] text-xl">{workshop.priceLabel}</strong>
        <Link className="card-link mt-0" href={`/workshops/${workshopRouteSegment(workshop)}`} aria-label={`View ${workshop.title} on ${workshop.dateLabel}`} data-analytics-event="cta_workshop_detail">
          View workshop <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
