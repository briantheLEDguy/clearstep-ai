import type { ReactNode } from "react";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function PublicPage({ children, mainClassName = "" }: { children: ReactNode; mainClassName?: string }) {
  return (
    <>
      <AnalyticsTracker />
      <SiteHeader />
      <main id="main-content" className={mainClassName}>{children}</main>
      <SiteFooter />
    </>
  );
}
