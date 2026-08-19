import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the Pages build reads the sanitized Supabase workshop catalog", async () => {
  const [catalog, home, listing, detail, sitemap] = await Promise.all([
    source("../lib/workshops.ts"),
    source("../app/page.tsx"),
    source("../app/workshops/page.tsx"),
    source("../app/workshops/[slug]/page.tsx"),
    source("../app/sitemap.ts"),
  ]);

  assert.match(catalog, /\/rest\/v1\/rpc\/public_workshop_catalog/u);
  assert.match(catalog, /NEXT_PUBLIC_SUPABASE_URL/u);
  assert.match(catalog, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/u);
  assert.match(catalog, /headers:[\s\S]*apikey:\s*publishableKey/u);
  assert.match(catalog, /return loadWorkshopCatalog\(\)/u);
  assert.doesNotMatch(catalog, /unstable_cache|server-only/u);
  assert.doesNotMatch(catalog, /service_role|SUPABASE_SECRET_KEY/u);

  for (const page of [home, listing, sitemap]) {
    assert.match(page, /getWorkshop(?:Catalog)?\(/u);
  }
  assert.match(detail, /getWorkshopByRouteSegment\(/u);
});

test("catalog mapping validates booking, price, schedule, and capacity fields", async () => {
  const catalog = await source("../lib/workshops.ts");

  for (const field of [
    "course_id",
    "session_id",
    "price_cents",
    "currency",
    "starts_at",
    "ends_at",
    "timezone",
    "capacity",
    "seats_left",
    "outcomes",
    "agenda",
  ]) {
    assert.match(catalog, new RegExp(`value\\.${field}`, "u"), field);
  }

  assert.match(catalog, /seatsLeft\s*>\s*capacity/u);
  assert.match(catalog, /Date\.parse\(startsAt\)\s*>=\s*Date\.parse\(endsAt\)/u);
  assert.match(catalog, /value\.currency\s*!==\s*"EUR"/u);
  assert.match(catalog, /status:\s*"unavailable",\s*workshops:\s*\[\]/u);
  assert.match(catalog, /status:\s*"empty",\s*workshops:\s*\[\]/u);
  assert.match(catalog, /\.filter\(\(workshop\):\s*workshop is Workshop\s*=>\s*workshop !== null\)/u);
});

test("the public frontend contains no hardcoded catalog inventory", async () => {
  const files = await Promise.all([
    source("../lib/workshops.ts"),
    source("../app/page.tsx"),
    source("../app/workshops/page.tsx"),
    source("../app/workshops/[slug]/page.tsx"),
    source("../app/sitemap.ts"),
    source("../components/workshop-card.tsx"),
  ]);
  const combined = files.join("\n");

  assert.doesNotMatch(combined, /aaaaaaaa-aaaa|bbbbbbbb-bbbb|cccccccc-cccc/u);
  assert.doesNotMatch(combined, /make-ai-useful|clearer-content-with-ai|simplify-admin-with-ai/u);
  assert.doesNotMatch(combined, /priceCents:\s*\d+|seatsLeft:\s*\d+/u);
  assert.match(combined, /not showing placeholder dates|cannot show reliable dates/u);
});

test("every exported workshop URL stays bound to its session", async () => {
  const [catalog, route, card, detail, booking, sitemap] = await Promise.all([
    source("../lib/workshops.ts"),
    source("../lib/workshop-route.ts"),
    source("../components/workshop-card.tsx"),
    source("../app/workshops/[slug]/page.tsx"),
    source("../components/booking-panel.tsx"),
    source("../app/sitemap.ts"),
  ]);

  assert.match(card, /workshopRouteSegment\(workshop\)/u);
  assert.match(catalog, /item\.slug\s*===\s*slug[\s\S]*item\.sessionId\s*===\s*safeSessionId/u);
  assert.match(route, /`\$\{workshop\.slug\}--\$\{workshop\.sessionId\}`/u);
  assert.match(route, /parseWorkshopRouteSegment/u);
  assert.match(detail, /getWorkshopByRouteSegment\(slug\)/u);
  assert.match(detail, /generateStaticParams/u);
  assert.match(booking, /`\/workshops\/\$\{workshopSlug\}--\$\{sessionId\}`/u);
  assert.match(sitemap, /catalog\.workshops\.map[\s\S]*workshopRouteSegment\(workshop\)/u);
});

test("admin-editable workshop copy cannot break out of JSON-LD scripts", async () => {
  const [serializer, detail, layout] = await Promise.all([
    source("../lib/json-ld.ts"),
    source("../app/workshops/[slug]/page.tsx"),
    source("../app/layout.tsx"),
  ]);

  assert.match(serializer, /\.replace\(\/<\/gu,\s*"\\\\u003c"\)/u);
  assert.match(serializer, /\\u2028/u);
  assert.match(serializer, /\\u2029/u);
  assert.match(detail, /serializeJsonLd\(structuredData\)/u);
  assert.match(layout, /serializeJsonLd\(organization\)/u);
  assert.doesNotMatch(detail, /__html:\s*JSON\.stringify/u);
});
