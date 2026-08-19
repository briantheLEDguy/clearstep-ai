export const PLATE_POST_SERVICE_SLUGS = [
  "basic-product-shoot",
  "video-content",
  "combo-package",
] as const;

export type PlatePostServiceSlug = (typeof PLATE_POST_SERVICE_SLUGS)[number];

export type ServicePackage = {
  catalogItemId: string;
  slug: PlatePostServiceSlug;
  title: string;
  summary: string;
  description: string;
  outcomes: string[];
  audience: string;
  durationMinutes: number | null;
  priceCents: number;
  currency: "EUR";
  businessUnit: "plate_and_post";
  offeringType: string;
  seoTitle: string;
  seoDescription: string;
};

export type ServiceCatalog =
  | { status: "ready"; services: ServicePackage[] }
  | { status: "empty" | "unavailable"; services: [] };

type JsonRecord = Record<string, unknown>;

const PUBLIC_SERVICE_CATALOG_PATH = "/rest/v1/rpc/public_service_catalog";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function stringList(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const items = value.map((item) => nonEmptyString(item, 500));
  return items.every((item): item is string => item !== null) ? items : null;
}

export function isPlatePostServiceSlug(value: unknown): value is PlatePostServiceSlug {
  return typeof value === "string" && (PLATE_POST_SERVICE_SLUGS as readonly string[]).includes(value);
}

function mapServicePackage(value: unknown): ServicePackage | null {
  if (!isRecord(value)) return null;

  const catalogItemId = nonEmptyString(value.catalog_item_id, 36);
  const slug = isPlatePostServiceSlug(value.slug) ? value.slug : null;
  const title = nonEmptyString(value.title, 240);
  const summary = nonEmptyString(value.summary, 1_000);
  const description = nonEmptyString(value.description, 10_000);
  const outcomes = stringList(value.outcomes);
  const audience = nonEmptyString(value.audience, 2_000);
  const durationMinutes = value.duration_minutes === null ? null : positiveInteger(value.duration_minutes);
  const priceCents = positiveInteger(value.price_cents);
  const offeringType = nonEmptyString(value.offering_type, 80);
  const seoTitle = nonEmptyString(value.seo_title, 240) ?? title;
  const seoDescription = nonEmptyString(value.seo_description, 1_000) ?? summary;

  if (
    !catalogItemId || !UUID_PATTERN.test(catalogItemId) || !slug || !title || !summary || !description
    || !outcomes || !audience || (value.duration_minutes !== null && !durationMinutes) || !priceCents
    || value.currency !== "EUR" || value.business_unit !== "plate_and_post" || !offeringType
    || !seoTitle || !seoDescription
  ) {
    return null;
  }

  return {
    catalogItemId,
    slug,
    title,
    summary,
    description,
    outcomes,
    audience,
    durationMinutes,
    priceCents,
    currency: "EUR",
    businessUnit: "plate_and_post",
    offeringType,
    seoTitle,
    seoDescription,
  };
}

async function loadPlatePostServiceCatalog(): Promise<ServiceCatalog> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/u, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return { status: "unavailable", services: [] };

  try {
    const response = await fetch(`${supabaseUrl}${PUBLIC_SERVICE_CATALOG_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_business_unit: "plate_and_post" }),
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) return { status: "unavailable", services: [] };
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.services) || payload.services.length > PLATE_POST_SERVICE_SLUGS.length) {
      return { status: "unavailable", services: [] };
    }
    if (payload.services.length === 0) return { status: "empty", services: [] };

    const services = payload.services.map(mapServicePackage).filter((service): service is ServicePackage => service !== null);
    if (services.length !== payload.services.length || new Set(services.map((service) => service.slug)).size !== services.length) {
      return { status: "unavailable", services: [] };
    }

    services.sort((left, right) =>
      PLATE_POST_SERVICE_SLUGS.indexOf(left.slug) - PLATE_POST_SERVICE_SLUGS.indexOf(right.slug),
    );
    return { status: "ready", services };
  } catch {
    return { status: "unavailable", services: [] };
  }
}

export function getPlatePostServiceCatalog() {
  return loadPlatePostServiceCatalog();
}

export async function getPlatePostService(slug: string) {
  const catalog = await getPlatePostServiceCatalog();
  return {
    catalogStatus: catalog.status,
    service: isPlatePostServiceSlug(slug)
      ? catalog.services.find((item) => item.slug === slug)
      : undefined,
  };
}

export function formatServicePrice(service: ServicePackage) {
  return new Intl.NumberFormat("en-NL", {
    style: "currency",
    currency: service.currency,
    minimumFractionDigits: Number.isInteger(service.priceCents / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(service.priceCents / 100);
}

export function formatServiceDuration(durationMinutes: number | null) {
  if (!durationMinutes) return null;
  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${durationMinutes} minutes`;
}
