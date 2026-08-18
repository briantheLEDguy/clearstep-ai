import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/site-origin";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Account/admin/status pages emit explicit noindex metadata. Keep them
      // crawlable so search engines can see that directive; block only routes
      // that may contain one-time authentication or invitation tokens.
      disallow: ["/auth/", "/staff/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
