import type { ReactNode } from "react";
import { AnalyticsConsentProvider } from "@/components/analytics-consent";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function PublicPage({ children, mainClassName = "" }: { children: ReactNode; mainClassName?: string }) {
  return (
    <AnalyticsConsentProvider>
      <AnalyticsTracker />
      <SiteHeader />
      <main id="main-content" className={mainClassName}>{children}</main>
      <SiteFooter />
    </AnalyticsConsentProvider>
  );
}
