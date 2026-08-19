const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type WorkshopRoute = {
  slug: string;
  sessionId?: string;
};

export function isWorkshopSessionId(value: string) {
  return UUID_PATTERN.test(value);
}

export function isWorkshopSlug(value: string) {
  return SLUG_PATTERN.test(value);
}

export function workshopRouteSegment(workshop: Pick<WorkshopRoute, "slug" | "sessionId"> & { sessionId: string }) {
  return `${workshop.slug}--${workshop.sessionId}`;
}

/**
 * Parses the public workshop route format in one place so links, route loaders,
 * and consented course analytics cannot disagree about which course is viewed.
 */
export function parseWorkshopRouteSegment(routeSegment: string): WorkshopRoute | null {
  const separatorIndex = routeSegment.lastIndexOf("--");
  if (separatorIndex < 0) {
    return isWorkshopSlug(routeSegment) ? { slug: routeSegment } : null;
  }

  const slug = routeSegment.slice(0, separatorIndex);
  const sessionId = routeSegment.slice(separatorIndex + 2);
  if (!isWorkshopSlug(slug) || !isWorkshopSessionId(sessionId)) return null;

  return { slug, sessionId };
}
