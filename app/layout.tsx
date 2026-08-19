import type { Metadata } from "next";
import localFont from "next/font/local";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/fraunces";
import { serializeJsonLd } from "@/lib/json-ld";
import { getSiteOrigin } from "@/lib/site-origin";
import { COMPANY_DETAILS } from "@/shared/company-details";
import "./globals.css";

const manrope = localFont({
  src: "../public/fonts/manrope-latin.woff2",
  variable: "--font-manrope",
  display: "swap",
  weight: "200 800",
});

const sourceSans = localFont({
  src: "../public/fonts/source-sans-3-latin.woff2",
  variable: "--font-source-sans",
  display: "swap",
  weight: "200 900",
});

export function generateMetadata(): Metadata {
  const origin = getSiteOrigin();
  return {
    metadataBase: new URL(origin),
    title: {
      default: "BNC Consulting — Clearstep AI and Plate & Post",
      template: "%s | BNC Consulting",
    },
    description: "Focused business services from Clearstep AI and Plate & Post.",
    openGraph: {
      type: "website",
      locale: "en_GB",
      siteName: "BNC Consulting",
      title: "BNC Consulting — Clearstep AI and Plate & Post",
      description: "Focused business services from Clearstep AI and Plate & Post.",
    },
    twitter: {
      card: "summary",
      title: "BNC Consulting — Clearstep AI and Plate & Post",
      description: "Focused business services from Clearstep AI and Plate & Post.",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const origin = getSiteOrigin();
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "BNC Consulting",
    legalName: COMPANY_DETAILS.name,
    url: origin,
    email: COMPANY_DETAILS.email,
    telephone: COMPANY_DETAILS.phone,
    description: "The home of Clearstep AI and Plate & Post.",
  };

  return (
    <html lang="en">
      <body className={`${manrope.variable} ${sourceSans.variable}`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(organization) }} />
        {children}
      </body>
    </html>
  );
}
