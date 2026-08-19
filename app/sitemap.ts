import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/site-origin";
import { getPlatePostServiceCatalog } from "@/lib/services";
import { getWorkshopCatalog, workshopRouteSegment } from "@/lib/workshops";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteOrigin();
  const [workshopCatalog, serviceCatalog] = await Promise.all([
    getWorkshopCatalog(),
    getPlatePostServiceCatalog(),
  ]);
  const staticRoutes = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/clearstep/", changeFrequency: "weekly", priority: 0.9 },
    { path: "/clearstep/workshops/", changeFrequency: "weekly", priority: 0.9 },
    { path: "/clearstep/private-workshops/", changeFrequency: "monthly", priority: 0.7 },
    { path: "/clearstep/about/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/clearstep/faq/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/plate-and-post/", changeFrequency: "weekly", priority: 0.9 },
    { path: "/plate-and-post/services/", changeFrequency: "weekly", priority: 0.8 },
    { path: "/plate-and-post/about/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/plate-and-post/faq/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/privacy/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/terms/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/cancellation/", changeFrequency: "monthly", priority: 0.6 },
    { path: "/complaints/", changeFrequency: "monthly", priority: 0.6 },
  ] as const;
  return [
    ...staticRoutes.map((route) => ({
      url: `${baseUrl}${route.path}`,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...workshopCatalog.workshops.map((workshop) => ({
      url: `${baseUrl}/clearstep/workshops/${workshopRouteSegment(workshop)}/`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...serviceCatalog.services.map((service) => ({
      url: `${baseUrl}/plate-and-post/services/${service.slug}/`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
