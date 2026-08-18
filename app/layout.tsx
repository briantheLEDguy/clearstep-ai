import type { Metadata } from "next";
import { Manrope, Source_Sans_3 } from "next/font/google";
import { serializeJsonLd } from "@/lib/json-ld";
import { getSiteOrigin } from "@/lib/site-origin";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

export function generateMetadata(): Metadata {
  const origin = getSiteOrigin();
  return {
    metadataBase: new URL(origin),
    title: {
      default: "Clearstep AI — Make AI useful. Keep it simple.",
      template: "%s | Clearstep AI",
    },
    description:
      "Practical AI workshops for freelancers and small businesses. Clear steps, real examples, no jargon.",
    icons: {
      icon: "/brand-mark.png",
      shortcut: "/brand-mark.png",
      apple: "/brand-mark.png",
    },
    openGraph: {
      type: "website",
      locale: "en_GB",
      siteName: "Clearstep AI",
      title: "Clearstep AI — Make AI useful. Keep it simple.",
      description: "Practical AI workshops for freelancers and small businesses.",
      images: [{
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Clearstep AI — Make AI useful. Keep it simple.",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Clearstep AI — Make AI useful. Keep it simple.",
      description: "Practical AI workshops for freelancers and small businesses.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const origin = getSiteOrigin();
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Clearstep AI",
    url: origin,
    logo: `${origin}/primary-logo.png`,
    email: "brian@bncconsulting.co",
    description: "Practical AI workshops for freelancers and small businesses.",
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
