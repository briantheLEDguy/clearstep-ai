import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/site-origin";
import { getWorkshopCatalog, workshopRouteSegment } from "@/lib/workshops";
export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteOrigin();
  const catalog = await getWorkshopCatalog();
  const staticRoutes = ["", "/workshops", "/private-workshops", "/about", "/faq", "/privacy", "/terms", "/cancellation", "/complaints"];
  return [
    ...staticRoutes.map((path) => ({
      url: `${baseUrl}${path}`,
      changeFrequency: path === "" || path === "/workshops" ? "weekly" as const : "monthly" as const,
      priority: path === "" ? 1 : path === "/workshops" ? 0.9 : 0.6,
    })),
    ...catalog.workshops.map((workshop) => ({
      url: `${baseUrl}/workshops/${workshopRouteSegment(workshop)}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
