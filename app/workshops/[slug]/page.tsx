import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingPanel } from "@/components/booking-panel";
import { PublicPage } from "@/components/public-page";
import { serializeJsonLd } from "@/lib/json-ld";
import { getSiteOrigin } from "@/lib/site-origin";
import { formatWorkshopDate, formatWorkshopLocation, getWorkshop } from "@/lib/workshops";

type WorkshopPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session?: string | string[] }>;
};

function requestedSession(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export const revalidate = 60;

export async function generateMetadata({ params, searchParams }: WorkshopPageProps): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const { catalogStatus, workshop } = await getWorkshop(slug, requestedSession(query.session));
  if (catalogStatus === "unavailable") {
    return {
      title: "Workshop details temporarily unavailable",
      description: "The Clearstep AI workshop calendar is being updated. Please check back shortly.",
      robots: { index: false, follow: true },
      openGraph: { images: [{ url: "/og.png", width: 1731, height: 909, alt: "Clearstep AI — Make AI useful. Keep it simple." }] },
      twitter: { card: "summary_large_image", images: ["/og.png"] },
    };
  }
  if (!workshop) return { title: "Workshop not found", robots: { index: false, follow: false } };

  const title = `${workshop.title} — ${workshop.dateLabel}`;
  const place = workshop.format === "Live online" ? "live online" : `in ${workshop.location}`;
  const description = `${workshop.summary} ${formatWorkshopDate(workshop)}, ${place}.`;
  const url = `/workshops/${workshop.slug}?session=${encodeURIComponent(workshop.sessionId)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url, images: [{ url: "/og.png", width: 1731, height: 909, alt: "Clearstep AI — Make AI useful. Keep it simple." }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default async function WorkshopDetailPage({ params, searchParams }: WorkshopPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const { catalogStatus, workshop } = await getWorkshop(slug, requestedSession(query.session));
  if (catalogStatus === "unavailable") {
    return (
      <PublicPage>
        <section className="shell py-20 md:py-28" role="status">
          <p className="eyebrow">Workshop calendar</p>
          <h1 className="max-w-3xl text-[clamp(2.8rem,6vw,4.7rem)] leading-[1.03]">Workshop details are being updated.</h1>
          <p className="mt-7 max-w-2xl text-xl leading-relaxed">
            We cannot show reliable dates, pricing, or availability right now. Please check back shortly.
          </p>
          <Link className="button button-primary mt-7" href="/workshops">View all workshops</Link>
        </section>
      </PublicPage>
    );
  }
  if (!workshop) notFound();

  const origin = getSiteOrigin();
  const workshopUrl = `${origin}/workshops/${workshop.slug}?session=${encodeURIComponent(workshop.sessionId)}`;
  const virtualLocation = { "@type": "VirtualLocation", url: workshopUrl };
  const physicalLocation = { "@type": "Place", name: workshop.location, address: { "@type": "PostalAddress", addressCountry: "NL" } };
  const location = workshop.format === "Live online"
    ? virtualLocation
    : workshop.format === "Hybrid"
      ? [physicalLocation, virtualLocation]
      : physicalLocation;
  const offer = {
    "@type": "Offer",
    price: (workshop.priceCents / 100).toFixed(2),
    priceCurrency: workshop.currency,
    availability: workshop.seatsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
    url: workshopUrl,
  };
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Course",
        name: workshop.title,
        description: workshop.summary,
        provider: { "@type": "Organization", name: "Clearstep AI", url: origin },
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: workshop.format === "Live online" ? "online" : workshop.format === "Hybrid" ? "blended" : "onsite",
          startDate: workshop.startsAt,
          endDate: workshop.endsAt,
          location,
        },
        offers: offer,
      },
      {
        "@type": "Event",
        name: workshop.title,
        description: workshop.summary,
        url: workshopUrl,
        startDate: workshop.startsAt,
        endDate: workshop.endsAt,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: workshop.format === "Live online"
          ? "https://schema.org/OnlineEventAttendanceMode"
          : workshop.format === "Hybrid"
            ? "https://schema.org/MixedEventAttendanceMode"
            : "https://schema.org/OfflineEventAttendanceMode",
        location,
        maximumAttendeeCapacity: workshop.capacity,
        organizer: { "@type": "Organization", name: "Clearstep AI", url: origin },
        offers: offer,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: origin },
          { "@type": "ListItem", position: 2, name: "Workshops", item: `${origin}/workshops` },
          { "@type": "ListItem", position: 3, name: workshop.title, item: workshopUrl },
        ],
      },
    ],
  };

  return (
    <PublicPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <section className="shell py-12 md:py-20">
        <Link className="text-link text-base" href="/workshops">← All workshops</Link>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
          <div>
            <p className="eyebrow">{workshop.eyebrow}</p>
            <h1 className="max-w-4xl text-[clamp(2.8rem,6vw,4.7rem)] leading-[1.03]">{workshop.title}</h1>
            <p className="mt-7 max-w-3xl text-xl leading-relaxed">{workshop.description}</p>
            <dl className="mt-9 grid gap-4 rounded-[26px] bg-[var(--mint)] p-6 sm:grid-cols-2 md:p-8">
              <div><dt className="text-sm font-bold uppercase tracking-[.08em] text-[var(--action)]">Date and time</dt><dd className="m-0 mt-1 font-bold">{formatWorkshopDate(workshop)}</dd></div>
              <div><dt className="text-sm font-bold uppercase tracking-[.08em] text-[var(--action)]">Location</dt><dd className="m-0 mt-1 font-bold">{formatWorkshopLocation(workshop)}</dd></div>
            </dl>
          </div>
          <BookingPanel
            workshopSlug={workshop.slug}
            workshopTitle={workshop.title}
            sessionId={workshop.sessionId}
            seatsLeft={workshop.seatsLeft}
            priceLabel={workshop.priceLabel}
          />
        </div>
      </section>
      <section className="bg-white py-16 md:py-24">
        <div className="shell grid gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow">What you’ll leave with</p>
            <h2 className="text-4xl">Useful work, not just ideas.</h2>
            <ul className="mt-7 grid list-none gap-4 p-0">
              {workshop.takeaways.map((takeaway) => (
                <li className="flex gap-3 rounded-2xl bg-[var(--cream)] p-4" key={takeaway}>
                  <span className="font-extrabold text-[var(--green)]" aria-hidden="true">✓</span><span>{takeaway}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">How the session works</p>
            <h2 className="text-4xl">Three clear steps.</h2>
            <ol className="mt-7 grid list-none gap-5 p-0">
              {workshop.agenda.map((item, index) => (
                <li className="grid grid-cols-[46px_1fr] gap-4" key={item.title}>
                  <span className="grid h-11 place-items-center rounded-xl bg-[var(--yellow)] font-bold">{index + 1}</span>
                  <div><h3 className="text-xl">{item.title}</h3><p className="mb-0 mt-1">{item.detail}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="shell grid gap-8 py-16 md:grid-cols-[1fr_1.4fr] md:py-24">
        <div><p className="eyebrow">Who it’s for</p><h2 className="text-4xl">You don’t need to be technical.</h2></div>
        <div className="rounded-[26px] border border-[var(--border)] bg-white p-7 md:p-9">
          <p className="m-0 text-xl">{workshop.audience}</p>
          <p className="mb-0 mt-5">Bring a laptop and one real task or example. We’ll provide the method, guidance, and room to practice.</p>
        </div>
      </section>
    </PublicPage>
  );
}
