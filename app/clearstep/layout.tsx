import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Clearstep AI — Make AI useful. Keep it simple.",
    template: "%s | Clearstep AI",
  },
  description: "Practical AI workshops for freelancers and small businesses. Clear steps, real examples, no jargon.",
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

export default function ClearstepLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
