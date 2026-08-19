import Link from "next/link";

import AdminNavLink from "@/components/admin/AdminNavLink";
import { BrandLogo } from "@/components/brand-logo";
import { getBrand, type BrandKey } from "@/lib/brands";

export function SiteHeader({ brandKey }: { brandKey: BrandKey }) {
  const brand = getBrand(brandKey);

  return (
    <header className="site-header shell">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:font-bold"
        href="#main-content"
      >
        Skip to content
      </a>
      <Link className="brand" href={brand.homeHref} aria-label={`${brand.name} home`}>
        <BrandLogo brandKey={brandKey} />
      </Link>
      <nav aria-label="Primary navigation">
        {brand.navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        <AdminNavLink />
        <Link className="nav-sign-in" href="/sign-in">Sign in</Link>
      </nav>
    </header>
  );
}
