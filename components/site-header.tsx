import Link from "next/link";

import AdminNavLink from "@/components/admin/AdminNavLink";

export function SiteHeader() {
  return (
    <header className="site-header shell">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--yellow)] focus:px-4 focus:py-2 focus:font-bold"
        href="#main-content"
      >
        Skip to content
      </a>
      <Link className="brand" href="/" aria-label="Clearstep AI home">
        {/* A plain static image keeps Sites output independent of an image-optimization service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/workshops">Workshops</Link>
        <Link href="/private-workshops">For teams</Link>
        <Link href="/about">About</Link>
        <AdminNavLink />
        <Link className="nav-sign-in" href="/sign-in">Sign in</Link>
      </nav>
    </header>
  );
}
