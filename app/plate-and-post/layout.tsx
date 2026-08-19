import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Plate & Post — Content made to be craved.",
    template: "%s | Plate & Post",
  },
  description: "Product photography and social content for food-first brands.",
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "Plate & Post",
    title: "Plate & Post — Content made to be craved.",
    description: "Product photography and social content for food-first brands.",
  },
  twitter: {
    card: "summary",
    title: "Plate & Post — Content made to be craved.",
    description: "Product photography and social content for food-first brands.",
  },
};

export default function PlateAndPostLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
