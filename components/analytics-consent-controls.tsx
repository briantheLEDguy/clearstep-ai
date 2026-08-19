"use client";

import { useAnalyticsConsent } from "@/components/analytics-consent";

export function AnalyticsConsentControls() {
  const { openSettings } = useAnalyticsConsent();
  return (
    <button className="text-left" onClick={openSettings} type="button">
      Privacy choices
    </button>
  );
}
