import "server-only";

import { unstable_cache } from "next/cache";

export const WORKSHOP_CATALOG_REVALIDATE_SECONDS = 60;

export type WorkshopFormat = "In person" | "Live online" | "Hybrid";
export type WorkshopStatus = "scheduled" | "sold_out";

export type Workshop = {
  courseId: string;
  sessionId: string;
  slug: string;
  eyebrow: string;
  title: string;
  summary: string;
  description: string;
  level: string;
  durationMinutes: number;
  format: WorkshopFormat;
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  priceLabel: string;
  priceCents: number;
  currency: "EUR";
  capacity: number;
  seatsLeft: number;
  status: WorkshopStatus;
  audience: string;
  takeaways: string[];
  agenda: { title: string; detail: string }[];
};

export type WorkshopCatalog =
  | { status: "ready"; workshops: Workshop[] }
  | { status: "empty" | "unavailable"; workshops: [] };

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SUPABASE_RPC_PATH = "/rest/v1/rpc/public_workshop_catalog";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 10_000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const values = value.map((item) => nonEmptyString(item, 500));
  return values.every((item): item is string => item !== null) ? values : null;
}

function agendaList(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;

  const agenda = value.map((item) => {
    if (!isRecord(item)) return null;
    const title = nonEmptyString(item.title, 120);
    const detail = nonEmptyString(item.detail, 500);
    return title && detail ? { title, detail } : null;
  });

  return agenda.every((item): item is { title: string; detail: string } => item !== null)
    ? agenda
    : null;
}

function validDateTime(value: unknown) {
  const normalized = nonEmptyString(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function validTimeZone(value: unknown) {
  const normalized = nonEmptyString(value, 100);
  if (!normalized) return null;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: normalized }).format(0);
    return normalized;
  } catch {
    return null;
  }
}

function formatDatePart(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

function formatTimePart(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

function formatPrice(priceCents: number, currency: "EUR") {
  const amount = priceCents / 100;
  return new Intl.NumberFormat("en-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function mapFormat(value: unknown): WorkshopFormat | null {
  if (value === "online") return "Live online";
  if (value === "in_person") return "In person";
  if (value === "hybrid") return "Hybrid";
  return null;
}

function mapWorkshop(value: unknown): Workshop | null {
  if (!isRecord(value)) return null;

  const courseId = nonEmptyString(value.course_id, 36);
  const sessionId = nonEmptyString(value.session_id, 36);
  const slug = nonEmptyString(value.slug, 120);
  const title = nonEmptyString(value.title, 240);
  const summary = nonEmptyString(value.summary, 1_000);
  const description = nonEmptyString(value.description, 10_000);
  const outcomes = stringList(value.outcomes);
  const level = nonEmptyString(value.level, 120);
  const audience = nonEmptyString(value.audience, 2_000);
  const agenda = agendaList(value.agenda);
  const durationMinutes = positiveInteger(value.duration_minutes);
  const priceCents = positiveInteger(value.price_cents);
  const format = mapFormat(value.format);
  const startsAt = validDateTime(value.starts_at);
  const endsAt = validDateTime(value.ends_at);
  const timezone = validTimeZone(value.timezone);
  const venue = value.venue === null ? null : nonEmptyString(value.venue, 500);
  const capacity = positiveInteger(value.capacity);
  const seatsLeft = nonNegativeInteger(value.seats_left);
  const status = value.status === "scheduled" || value.status === "sold_out" ? value.status : null;

  if (
    !courseId || !UUID_PATTERN.test(courseId)
    || !sessionId || !UUID_PATTERN.test(sessionId)
    || !slug || !SLUG_PATTERN.test(slug)
    || !title || !summary || !description || !outcomes || !level || !audience || !agenda
    || !durationMinutes || !priceCents || value.currency !== "EUR" || !format
    || !startsAt || !endsAt || Date.parse(startsAt) >= Date.parse(endsAt) || !timezone
    || !capacity || seatsLeft === null || seatsLeft > capacity || !status
    || (format !== "Live online" && !venue)
  ) {
    return null;
  }

  const location = format === "Live online" ? "Online" : venue as string;
  const eyebrow = format === "Live online"
    ? "Live online"
    : format === "Hybrid"
      ? "Hybrid workshop"
      : `${level} workshop`;

  return {
    courseId,
    sessionId,
    slug,
    eyebrow,
    title,
    summary,
    description,
    level,
    durationMinutes,
    format,
    startsAt,
    endsAt,
    dateLabel: formatDatePart(startsAt, timezone),
    startTime: formatTimePart(startsAt, timezone),
    endTime: formatTimePart(endsAt, timezone),
    timezone,
    location,
    priceLabel: formatPrice(priceCents, "EUR"),
    priceCents,
    currency: "EUR",
    capacity,
    seatsLeft,
    status,
    audience,
    takeaways: outcomes,
    agenda,
  };
}

async function loadWorkshopCatalog(): Promise<WorkshopCatalog> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/u, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) return { status: "unavailable", workshops: [] };

  try {
    const response = await fetch(`${supabaseUrl}${SUPABASE_RPC_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) return { status: "unavailable", workshops: [] };

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.workshops) || payload.workshops.length > 100) {
      return { status: "unavailable", workshops: [] };
    }

    if (payload.workshops.length === 0) return { status: "empty", workshops: [] };

    const workshops = payload.workshops.map(mapWorkshop).filter((workshop): workshop is Workshop => workshop !== null);
    if (workshops.length === 0) {
      return { status: "unavailable", workshops: [] };
    }

    const sortedWorkshops = workshops.sort((left, right) =>
      Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.title.localeCompare(right.title),
    );

    return { status: "ready", workshops: sortedWorkshops };
  } catch {
    return { status: "unavailable", workshops: [] };
  }
}

const getCachedWorkshopCatalog = unstable_cache(
  loadWorkshopCatalog,
  ["clearstep-public-workshop-catalog-v1"],
  { revalidate: WORKSHOP_CATALOG_REVALIDATE_SECONDS },
);

export function getWorkshopCatalog() {
  return getCachedWorkshopCatalog();
}

export async function getWorkshop(slug: string, sessionId?: string) {
  const catalog = await getWorkshopCatalog();
  const safeSessionId = sessionId && UUID_PATTERN.test(sessionId) ? sessionId : undefined;
  return {
    catalogStatus: catalog.status,
    workshop: catalog.workshops.find((item) =>
      item.slug === slug && (!sessionId || (safeSessionId !== undefined && item.sessionId === safeSessionId)),
    ),
  };
}

export function formatWorkshopDate(workshop: Workshop) {
  return `${workshop.dateLabel} · ${workshop.startTime}–${workshop.endTime}`;
}

export function formatWorkshopAvailability(workshop: Workshop) {
  if (workshop.seatsLeft === 0 || workshop.status === "sold_out") return "Waitlist available";
  return workshop.seatsLeft === 1 ? "1 place available" : `${workshop.seatsLeft} places available`;
}

export function formatWorkshopLocation(workshop: Workshop) {
  if (workshop.format === "Live online") return "Live online";
  return workshop.format === "Hybrid" ? `${workshop.location} · Hybrid` : workshop.location;
}
