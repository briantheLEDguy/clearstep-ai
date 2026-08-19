import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("browser analytics are opt-in, anonymous, and controllable from every public footer", async () => {
  const [consent, transport, tracker, footer, publicPage, route, publicConfig] = await Promise.all([
    source("../components/analytics-consent.tsx"),
    source("../lib/analytics.ts"),
    source("../components/analytics-tracker.tsx"),
    source("../components/site-footer.tsx"),
    source("../components/public-page.tsx"),
    source("../lib/workshop-route.ts"),
    source("../lib/supabase/public-config.ts"),
  ]);

  assert.match(consent, /const cookie = document\.cookie[\s\S]*readAnalyticsConsent\(cookie\)/u);
  assert.match(consent, /else if \(hasStoredChoice \|\| pendingWithdrawal\)[\s\S]*deactivateAnalytics\(\)/u);
  assert.match(consent, /grantAnalyticsConsent\(\)/u);
  assert.match(consent, /withdrawAnalyticsConsent\(consentId\)/u);
  assert.match(consent, /deactivateAnalytics\(\)/u);
  assert.match(consent, /<dialog/u);
  assert.match(consent, /dialog\.showModal\(\)/u);
  assert.match(consent, /onCancel=\{\(event\)/u);
  assert.doesNotMatch(consent, /window\.addEventListener\("keydown"/u);
  assert.match(consent, /acceptButtonRef\.current\?\.focus\(\)/u);
  assert.match(consent, /restoreFocusRef/u);
  assert.match(consent, /Accept analytics/u);
  assert.match(consent, /Reject analytics/u);
  assert.match(footer, /AnalyticsConsentControls/u);
  assert.match(publicPage, /<AnalyticsConsentProvider>/u);

  assert.match(transport, /if \(!activeConsent \|\| typeof window === "undefined"\) return null/u);
  assert.match(transport, /sessionStorage\.setItem/u);
  assert.match(transport, /sessionStorage\.removeItem/u);
  assert.match(transport, /credentials: "omit"/u);
  assert.match(transport, /referrerPolicy: "no-referrer"/u);
  assert.doesNotMatch(transport, /getSupabaseBrowserClient|authorization/i);
  assert.match(transport, /name === "page_view" \|\| name === "course_view"/u);

  assert.match(tracker, /return enabled \? <EnabledAnalyticsTracker \/> : null/u);
  assert.match(tracker, /function EnabledAnalyticsTracker\(\)[\s\S]*usePathname\(\)/u);
  assert.match(tracker, /parseWorkshopRouteSegment/u);
  assert.doesNotMatch(tracker, /addEventListener|data-analytics-event/u);
  assert.match(route, /export function parseWorkshopRouteSegment/u);
  assert.match(route, /isWorkshopSessionId\(sessionId\)/u);
  assert.match(publicConfig, /parsed\.hostname === "127\.0\.0\.1"/u);
  assert.match(publicConfig, /parsed\.protocol === "http:" && localHost/u);
});
