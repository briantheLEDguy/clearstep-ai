import type { ReactNode } from "react";
import { AnalyticsConsentProvider } from "@/components/analytics-consent";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getBrand, type BrandKey } from "@/lib/brands";

export function PublicPage({
  brandKey = "bnc",
  children,
  mainClassName = "",
}: {
  brandKey?: BrandKey;
  children: ReactNode;
  mainClassName?: string;
}) {
  return (
    <AnalyticsConsentProvider>
      <div className="brand-surface" data-brand={getBrand(brandKey).theme}>
        <AnalyticsTracker />
        <SiteHeader brandKey={brandKey} />
        <main id="main-content" className={mainClassName}>{children}</main>
        <SiteFooter brandKey={brandKey} />
      </div>
    </AnalyticsConsentProvider>
  );
}
