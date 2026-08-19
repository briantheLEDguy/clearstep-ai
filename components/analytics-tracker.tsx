"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAnalyticsConsent } from "@/components/analytics-consent";
import { trackEvent } from "@/lib/analytics";
import { parseWorkshopRouteSegment } from "@/lib/workshop-route";

function campaignProperties() {
  const params = new URLSearchParams(window.location.search);
  const properties: Record<string, string> = {};
  for (const key of ["utm_source"] as const) {
    const value = params.get(key)?.trim();
    if (value && /^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(value)) properties[key] = value.toLowerCase();
  }
  return properties;
}

export function AnalyticsTracker() {
  const { enabled } = useAnalyticsConsent();

  return enabled ? <EnabledAnalyticsTracker /> : null;
}

function EnabledAnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const properties = campaignProperties();
    void trackEvent("page_view", properties);

    const routeSegment = pathname.match(/^\/clearstep\/workshops\/([^/]+)$/u)?.[1];
    const workshopRoute = routeSegment ? parseWorkshopRouteSegment(routeSegment) : null;
    if (workshopRoute) {
      void trackEvent("course_view", { ...properties, course_slug: workshopRoute.slug });
    }
  }, [pathname]);

  return null;
}
