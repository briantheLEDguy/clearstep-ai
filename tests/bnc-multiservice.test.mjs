import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the typed brand registry drives one shared public shell", async () => {
  const [brands, publicPage, header, footer, logo, styles] = await Promise.all([
    source("../lib/brands.ts"),
    source("../components/public-page.tsx"),
    source("../components/site-header.tsx"),
    source("../components/site-footer.tsx"),
    source("../components/brand-logo.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(brands, /export type BrandKey\s*=\s*\(typeof BRAND_KEYS\)\[number\]/u);
  assert.match(brands, /\["bnc",\s*"clearstep",\s*"plateAndPost"\]/u);
  assert.match(publicPage, /brandKey\?: BrandKey/u);
  assert.match(publicPage, /data-brand=\{getBrand\(brandKey\)\.theme\}/u);
  assert.match(header, /brand\.navigation\.map/u);
  assert.match(footer, /brand\.footerLinks\.map/u);
  assert.doesNotMatch(logo, /plate-post-(mark|plate|post|ampersand)/u);

  for (const token of ["--color-text", "--color-action", "--color-surface", "--color-border"]) {
    assert.match(styles, new RegExp(token, "u"));
  }
  assert.match(styles, /--navy:\s*var\(--color-surface-strong\)/u);
  const plateTheme = styles.slice(styles.indexOf('.brand-surface[data-brand="plate-and-post"]'));
  for (const color of ["#2b1c27", "#e4573d", "#fff5e8", "#7e8b5a", "#f0b28e"]) {
    assert.match(plateTheme, new RegExp(color, "iu"));
  }
});

test("BNC is the root and service pages live under explicit namespaces", async () => {
  const [home, clearstep, workshop, booking, plateAbout, plateFaq] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/clearstep/page.tsx"),
    source("../app/clearstep/workshops/[slug]/page.tsx"),
    source("../components/booking-panel.tsx"),
    source("../app/plate-and-post/about/page.tsx"),
    source("../app/plate-and-post/faq/page.tsx"),
  ]);

  assert.match(home, /One business\.<br \/>Two focused service lines\./u);
  assert.match(home, /Practical AI education and food-first content services\./u);
  assert.match(home, /href="\/clearstep"/u);
  assert.match(home, /href="\/plate-and-post"/u);
  assert.match(clearstep, /brandKey="clearstep"/u);
  assert.match(clearstep, /canonical:\s*"\/clearstep"/u);
  assert.match(workshop, /`\/clearstep\/workshops\/\$\{workshopRouteSegment\(workshop\)\}`/u);
  assert.match(booking, /targetType:\s*"workshop"/u);
  assert.match(plateAbout, /canonical:\s*"\/plate-and-post\/about"/u);
  assert.match(plateFaq, /canonical:\s*"\/plate-and-post\/faq"/u);
  assert.match(plateFaq, /serializeJsonLd/u);

  await assert.rejects(access(new URL("../app/workshops/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/private-workshops/page.tsx", import.meta.url)));
});

test("Plate & Post prices and checkout are sourced only from published offerings", async () => {
  const [catalog, listing, detail, checkout, checkoutResponse, card] = await Promise.all([
    source("../lib/services.ts"),
    source("../app/plate-and-post/services/page.tsx"),
    source("../app/plate-and-post/services/[slug]/page.tsx"),
    source("../components/service-checkout.tsx"),
    source("../lib/checkout.ts"),
    source("../components/service-package-card.tsx"),
  ]);

  assert.match(catalog, /\/rest\/v1\/rpc\/public_service_catalog/u);
  assert.match(catalog, /p_business_unit:\s*"plate_and_post"/u);
  assert.match(catalog, /value\.business_unit\s*!==\s*"plate_and_post"/u);
  assert.match(catalog, /nonEmptyString\(value\.title, 240\)/u);
  assert.match(catalog, /nonEmptyString\(value\.seo_description, 1_000\) \?\? summary/u);
  assert.match(listing, /catalog\.status === "ready"/u);
  assert.match(detail, /PLATE_POST_SERVICE_SLUGS\.map/u);
  assert.match(detail, /StaffServicePreview/u);
  assert.doesNotMatch(detail, /schema\.org\/InStock|availability:/u);
  assert.match(card, /formatServicePrice\(service\)/u);

  assert.match(checkout, /targetType:\s*"service"/u);
  assert.match(checkout, /serviceLine:\s*"plate_and_post"/u);
  assert.match(checkout, /offeringSlug:\s*serviceSlug/u);
  assert.match(checkout, /parseCheckoutResponse/u);
  assert.match(checkoutResponse, /\["checkoutUrl",\s*"expiresAt",\s*"checkoutRef"\]/u);
  assert.match(checkoutResponse, /checkoutUrl\.protocol !== "https:"/u);
  assert.doesNotMatch(checkout, /result\?\.url|url\?: unknown/u);

  const combined = [listing, detail, card].join("\n");
  assert.doesNotMatch(combined, /priceCents:\s*(?:5000|7500|10000)|€\s*(?:50|75|100)/u);
  assert.match(combined, /No draft price|do not show draft offers/u);
});

test("draft service previews are fetched only after an owner or admin check", async () => {
  const preview = await source("../components/staff-service-preview.tsx");
  const contextCall = preview.indexOf('"staff_context"');
  const offeringCall = preview.indexOf('"service_offerings_list"');

  assert.ok(contextCall >= 0 && offeringCall > contextCall);
  assert.match(preview, /context\?\.role !== "owner" && context\?\.role !== "admin"/u);
  assert.match(preview, /item\.business_unit !== "plate_and_post"/u);
  assert.match(preview, /if \(state\.kind === "hidden"\) return null/u);
  assert.match(preview, /Sandbox · staff-only draft preview/u);
  assert.doesNotMatch(preview, /stripe_product_id\}|stripe_price_id\}/u);
});

test("one BNC account independently loads workshop bookings and service orders", async () => {
  const [account, requests] = await Promise.all([
    source("../components/account-dashboard.tsx"),
    source("../components/customer-requests-panel.tsx"),
  ]);

  assert.match(account, /Promise\.all\(\[/u);
  assert.match(account, /rpc\("my_enrollment_details"\)/u);
  assert.match(account, /rpc\("list_my_service_orders",\s*\{ p_user_id: userData\.user\.id \}\)/u);
  assert.match(account, /setWorkshopNotice/u);
  assert.match(account, /setServiceOrderNotice/u);
  assert.match(account, /id="your-workshops"/u);
  assert.match(account, /id="your-service-orders"/u);
  assert.match(account, /serviceOrders=\{serviceOrders\.map/u);
  assert.match(account, /item\.service_title\.length <= 240/u);
  assert.match(requests, /action:\s*"create_purchase_request"/u);
  assert.match(requests, /serviceOrderId:\s*targetId/u);
  assert.match(requests, /kind === "cancellation" \|\| kind === "change"/u);
});

test("shared checkout returns are BNC-neutral and target-aware", async () => {
  const [content, success, cancel] = await Promise.all([
    source("../components/checkout-return-content.tsx"),
    source("../app/checkout/success/page.tsx"),
    source("../app/checkout/cancel/page.tsx"),
  ]);

  assert.match(content, /value === "service" \|\| value === "workshop"/u);
  assert.match(content, /\/plate-and-post\/services/u);
  assert.match(content, /\/clearstep\/workshops/u);
  assert.match(content, /arrange the brief and scheduling/u);
  assert.match(success, /brandKey="bnc"/u);
  assert.match(cancel, /brandKey="bnc"/u);
  assert.doesNotMatch(`${success}\n${cancel}`, /href="\/workshops"/u);
});

test("sitemap entries use the exported trailing-slash canonicals", async () => {
  const sitemap = await source("../app/sitemap.ts");

  for (const path of [
    "/clearstep/",
    "/clearstep/workshops/",
    "/plate-and-post/",
    "/plate-and-post/services/",
  ]) {
    assert.match(sitemap, new RegExp(`path: "${path}"`, "u"));
  }
  assert.match(sitemap, /workshopRouteSegment\(workshop\)\}\/`/u);
  assert.match(sitemap, /services\/\$\{service\.slug\}\/`/u);
});

test("private quotes use the explicit checkout target and the shared response validator", async () => {
  const [checkout, waitlist] = await Promise.all([
    source("../components/private-quote-checkout.tsx"),
    source("../components/waitlist-offer.tsx"),
  ]);

  assert.match(checkout, /targetType:\s*"private_quote"/u);
  assert.match(checkout, /quoteToken,\s*legalAccepted:\s*true/u);
  assert.match(checkout, /parseCheckoutResponse\(unwrapFunctionData\(data\)\)/u);
  assert.doesNotMatch(checkout, /body:\s*\{\s*quoteToken,\s*legalAccepted:\s*true\s*\}/u);
  assert.match(waitlist, /targetType:\s*"workshop"/u);
  assert.match(waitlist, /parseCheckoutResponse\(unwrapFunctionData\(data\)\)/u);
});
