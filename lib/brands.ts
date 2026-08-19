export const BRAND_KEYS = ["bnc", "clearstep", "plateAndPost"] as const;

export type BrandKey = (typeof BRAND_KEYS)[number];

export type BrandLink = {
  href: string;
  label: string;
};

export type BrandDefinition = {
  key: BrandKey;
  theme: "bnc" | "clearstep" | "plate-and-post";
  name: string;
  homeHref: string;
  tagline: string;
  description: string;
  logo: { kind: "image"; src: string; width: number; height: number } | { kind: "wordmark" };
  navigation: readonly BrandLink[];
  footerLinks: readonly BrandLink[];
};

const sharedFooterLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cancellations", href: "/cancellation" },
  { label: "Complaints", href: "/complaints" },
] as const;

export const BRANDS = {
  bnc: {
    key: "bnc",
    theme: "bnc",
    name: "BNC Consulting",
    homeHref: "/",
    tagline: "Focused services for practical business growth.",
    description: "The home of Clearstep AI and Plate & Post.",
    logo: { kind: "wordmark" },
    navigation: [
      { label: "Services", href: "/#services" },
      { label: "Clearstep AI", href: "/clearstep" },
      { label: "Plate & Post", href: "/plate-and-post" },
    ],
    footerLinks: [
      { label: "Services", href: "/#services" },
      ...sharedFooterLinks,
    ],
  },
  clearstep: {
    key: "clearstep",
    theme: "clearstep",
    name: "Clearstep AI",
    homeHref: "/clearstep",
    tagline: "Make AI useful. Keep it simple.",
    description: "Practical AI workshops for people who want useful results, clear methods, and room to ask questions.",
    logo: { kind: "image", src: "/primary-logo.png", width: 200, height: 53 },
    navigation: [
      { label: "Workshops", href: "/clearstep/workshops" },
      { label: "Guides", href: "/clearstep/guides" },
      { label: "For teams", href: "/clearstep/private-workshops" },
      { label: "About", href: "/clearstep/about" },
    ],
    footerLinks: [
      { label: "Workshops", href: "/clearstep/workshops" },
      { label: "Private workshops", href: "/clearstep/private-workshops" },
      { label: "About", href: "/clearstep/about" },
      { label: "FAQ", href: "/clearstep/faq" },
      ...sharedFooterLinks,
    ],
  },
  plateAndPost: {
    key: "plateAndPost",
    theme: "plate-and-post",
    name: "Plate & Post",
    homeHref: "/plate-and-post",
    tagline: "Content made to be craved.",
    description: "Product photography and social content for food-first brands.",
    // Fallback until approved Canva SVG, PNG, and favicon exports are available locally.
    logo: { kind: "wordmark" },
    navigation: [
      { label: "Services", href: "/plate-and-post/services" },
      { label: "How it works", href: "/plate-and-post#process" },
      { label: "About", href: "/plate-and-post/about" },
      { label: "FAQ", href: "/plate-and-post/faq" },
      { label: "Clearstep AI", href: "/clearstep" },
    ],
    footerLinks: [
      { label: "Services", href: "/plate-and-post/services" },
      { label: "About", href: "/plate-and-post/about" },
      { label: "FAQ", href: "/plate-and-post/faq" },
      { label: "BNC Consulting", href: "/" },
      ...sharedFooterLinks,
    ],
  },
} as const satisfies Record<BrandKey, BrandDefinition>;

export function getBrand(brandKey: BrandKey): BrandDefinition {
  return BRANDS[brandKey];
}
