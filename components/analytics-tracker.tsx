"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";

function campaignProperties() {
  const params = new URLSearchParams(window.location.search);
  const properties: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    const value = params.get(key)?.trim();
    if (value) properties[key] = value.slice(0, 200);
  }
  return properties;
}

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const properties = campaignProperties();
    void trackEvent("page_view", properties);

    const workshopMatch = pathname.match(/^\/workshops\/([a-z0-9-]+)$/u);
    if (workshopMatch) {
      void trackEvent("course_view", { ...properties, course_slug: workshopMatch[1] });
    }

    function trackClick(event: MouseEvent) {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-analytics-event]")
        : null;
      const eventName = target?.dataset.analyticsEvent;
      if (!eventName || !/^[a-z][a-z0-9_]{1,63}$/u.test(eventName)) return;

      const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") : null;
      void trackEvent(eventName, href?.startsWith("/") ? { target_path: href } : {});
    }

    document.addEventListener("click", trackClick);
    return () => document.removeEventListener("click", trackClick);
  }, [pathname]);

  return null;
}
