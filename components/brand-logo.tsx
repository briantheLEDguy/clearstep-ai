import { getBrand, type BrandKey } from "@/lib/brands";

export function BrandLogo({ brandKey, inverse = false }: { brandKey: BrandKey; inverse?: boolean }) {
  const brand = getBrand(brandKey);

  if (brand.logo.kind === "image") {
    return (
      // A plain image keeps the static export independent of an image-optimisation service.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={inverse ? "brand-logo-image brand-logo-image-inverse" : "brand-logo-image"}
        src={brand.logo.src}
        alt={brand.name}
        width={brand.logo.width}
        height={brand.logo.height}
      />
    );
  }

  // TODO(brand-assets): replace the Plate & Post text fallback after approved Canva SVG/PNG exports are added locally.
  return <span className="brand-wordmark" data-brand-wordmark={brand.theme}>{brand.name}</span>;
}
