import Link from "next/link";
import { AnalyticsConsentControls } from "@/components/analytics-consent-controls";
import { BrandLogo } from "@/components/brand-logo";
import { getBrand, type BrandKey } from "@/lib/brands";
import { COMPANY_DETAILS } from "@/shared/company-details";

export function SiteFooter({ brandKey }: { brandKey: BrandKey }) {
  const brand = getBrand(brandKey);

  return (
    <footer className="mt-20 bg-[var(--color-surface-strong)] py-12 text-[var(--color-on-strong)]">
      <div className="shell grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="footer-brand mb-5"><BrandLogo brandKey={brandKey} inverse /></div>
          <p className="m-0 max-w-xl text-base text-white/75">{brand.description}</p>
          <p className="mb-0 mt-5 text-sm text-white/75"><strong>{COMPANY_DETAILS.name}</strong> · {COMPANY_DETAILS.location}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 font-bold text-[var(--color-surface-soft)] underline underline-offset-4">
            <a href={`tel:${COMPANY_DETAILS.phoneHref}`}>{COMPANY_DETAILS.phone}</a>
            <a href={`mailto:${COMPANY_DETAILS.email}`}>{COMPANY_DETAILS.email}</a>
          </div>
        </div>
        <div className="flex max-w-xl flex-wrap gap-x-6 gap-y-3 text-sm font-semibold" aria-label="Footer links">
          {brand.footerLinks.map(({ label, href }) => <Link key={href} href={href}>{label}</Link>)}
          <AnalyticsConsentControls />
        </div>
      </div>
      <div className="shell mt-10 border-t border-white/15 pt-6 text-sm text-white/60">
        © 2026 {brand.name} · {COMPANY_DETAILS.name}. {brand.tagline}
      </div>
    </footer>
  );
}
