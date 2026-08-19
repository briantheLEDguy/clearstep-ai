import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ANALYTICS_ENDPOINT = "http://127.0.0.1:3000/functions/v1/analytics-ingest";
const ADMIN_ENDPOINT = "http://127.0.0.1:3000/functions/v1/admin-catalog";
const AUTH_USER_ENDPOINT = "http://127.0.0.1:3000/auth/v1/user";
const TEST_CONSENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_STORAGE_KEY = "clearstep_analytics_session";
const SUPABASE_SESSION_STORAGE_KEY = "sb-127-auth-token";

const ADMIN_ANALYTICS_SUMMARY = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-19T00:00:00.000Z",
  page_views: 40,
  course_views: 24,
  checkout_starts: 8,
  confirmed_enrollments: 5,
  revenue_cents: 75000,
  gross_revenue_cents: 75000,
  net_revenue_cents: 75000,
  refund_count: 0,
  refunded_cents: 0,
  private_requests: 2,
  waitlist_joins: 3,
  waitlist_offers: 1,
  waitlist_acceptances: 1,
  automation_failures: 0,
  currency: "EUR",
  top_courses: [],
  utm_sources: [],
  upcoming_occupancy: [],
};

function testAccessToken(user, expiresAt) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: user.aud,
    email: user.email,
    exp: expiresAt,
    role: user.role,
    sub: user.id,
  })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

async function mockAnalytics(page, requests) {
  await page.route(ANALYTICS_ENDPOINT, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "http://127.0.0.1:3000",
          "access-control-allow-headers": "apikey, content-type",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
      return;
    }
    const body = JSON.parse(request.postData() || "{}");
    requests.push({ body, headers: request.headers() });

    if (body.action === "grant") {
      await route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://127.0.0.1:3000" },
        body: JSON.stringify({ data: { consentId: TEST_CONSENT_ID } }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:3000" },
      body: JSON.stringify({ data: { accepted: true } }),
    });
  });
}

async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function mockStaffWorkspace(page, role) {
  const user = {
    id: role === "owner" ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333",
    aud: "authenticated",
    role: "authenticated",
    email: `${role}@clearstep.example`,
    email_confirmed_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: testAccessToken(user, expiresAt),
    refresh_token: `test-${role}-refresh-token`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
  };

  await page.addInitScript(({ storageKey, storedSession, storedUser }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedSession));
    window.localStorage.setItem(`${storageKey}-user`, JSON.stringify({ user: storedUser }));
  }, { storageKey: SUPABASE_SESSION_STORAGE_KEY, storedSession: session, storedUser: user });

  await page.route(AUTH_USER_ENDPOINT, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
  });
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const response = body.action === "staff_context"
      ? { data: { role }, error: null }
      : body.action === "dashboard_overview" || body.action === "analytics_summary"
        ? { data: ADMIN_ANALYTICS_SUMMARY, error: null }
        : { data: null, error: { code: "unexpected_test_action", message: `Unexpected action: ${body.action}` } };
    await route.fulfill({
      status: response.error ? 400 : 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

test("analytics stays completely inactive until consent, then withdraws cleanly", async ({ page }) => {
  const requests = [];
  await mockAnalytics(page, requests);
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Optional website analytics" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.tagName)).toBe("DIALOG");
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull();
  await page.waitForTimeout(250);
  expect(requests).toEqual([]);

  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Accept analytics" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => requests.some(({ body }) => body.action === "event")).toBe(true);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)).not.toBeNull();

  const grant = requests.find(({ body }) => body.action === "grant");
  const event = requests.find(({ body }) => body.action === "event");
  expect(grant.body).toEqual({ action: "grant", policyVersion: "2026-08-19" });
  expect(event.body).toMatchObject({
    action: "event",
    consentId: TEST_CONSENT_ID,
    eventName: "page_view",
  });
  expect(event.body).not.toHaveProperty("userId");
  expect(event.body).not.toHaveProperty("path");
  expect(event.body).not.toHaveProperty("referrer");
  expect(event.headers.authorization).toBeUndefined();
  expect(event.headers.cookie).toBeUndefined();

  const privacyChoices = page.getByRole("button", { name: "Privacy choices" });
  await privacyChoices.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.evaluate((element) => element.contains(document.activeElement))).resolves.toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(privacyChoices).toBeFocused();
  await privacyChoices.click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Turn off analytics" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull();
  await expect.poll(() => requests.some(({ body }) => body.action === "withdraw")).toBe(true);
});

test("public pages reflow and have no automated accessibility violations at desktop and 320px", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 320, height: 900 },
  ]) {
    for (const [path, heading] of [
      ["/", "One business. Two focused service lines."],
      ["/clearstep/", "Make AI useful. Keep it simple."],
      ["/plate-and-post/", "Content made to be craved."],
      ["/plate-and-post/services/", "Choose the content package your brand needs."],
      ["/plate-and-post/about/", "Product content with a food-first point of view."],
      ["/plate-and-post/faq/", "Questions before you book Plate & Post."],
      ["/privacy/", "Privacy policy"],
      ["/complaints/", "Complaints procedure"],
    ]) {
      await page.context().clearCookies();
      await page.setViewportSize(viewport);
      await page.goto(path);
      await page.getByRole("button", { name: "Reject analytics" }).click();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
      await expectNoAxeViolations(page);
    }
  }
});

test("the unauthenticated admin gate is keyboard-accessible", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.getByRole("main")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("the analyst admin workspace exposes only analyst navigation and has no Axe violations", async ({ page }) => {
  await mockStaffWorkspace(page, "analyst");
  await page.goto("/admin/analytics/");

  const navigation = page.getByRole("navigation", { name: "Staff workspace navigation" });
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByLabel("Signed in as analyst@clearstep.example, analyst")).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Analytics", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Service catalog", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Automation", exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("the owner admin workspace exposes owner navigation and has no Axe violations", async ({ page }) => {
  await mockStaffWorkspace(page, "owner");
  await page.goto("/admin/");

  const navigation = page.getByRole("navigation", { name: "Staff workspace navigation" });
  await expect(page.getByRole("heading", { name: "Service operations", exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Signed in as owner@clearstep.example, owner")).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Service catalog", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Bookings & orders", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Customer requests", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Team", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Audit log", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Integrations", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Automation", exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
});
