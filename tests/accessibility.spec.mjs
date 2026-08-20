import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ANALYTICS_ENDPOINT = "http://127.0.0.1:3000/functions/v1/analytics-ingest";
const ADMIN_ENDPOINT = "http://127.0.0.1:3000/functions/v1/admin-catalog";
const AUTH_AUTHORIZE_ENDPOINT = "http://127.0.0.1:3000/auth/v1/authorize";
const AUTH_TOKEN_ENDPOINT = "http://127.0.0.1:3000/auth/v1/token?grant_type=pkce";
const AUTH_USER_ENDPOINT = "http://127.0.0.1:3000/auth/v1/user";
const TEST_CONSENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_STORAGE_KEY = "clearstep_analytics_session";
const SUPABASE_SESSION_STORAGE_KEY = "sb-127-auth-token";
const ONE_TIME_AUTH_PARAMS = ["code", "sb_flow_id", "error", "error_code", "error_description"];

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

function testAuthFixture({ id, email, refreshToken }) {
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: testAccessToken(user, expiresAt),
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
  };
  return { session, user };
}

async function persistAuthSession(page, { session, user }) {
  await page.addInitScript(({ storageKey, storedSession, storedUser }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedSession));
    window.localStorage.setItem(`${storageKey}-user`, JSON.stringify({ user: storedUser }));
  }, { storageKey: SUPABASE_SESSION_STORAGE_KEY, storedSession: session, storedUser: user });
}

async function mockAuthUser(page, user) {
  await page.route(AUTH_USER_ENDPOINT, async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
  });
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

async function expectScrubbedCallbackUrl(page) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      hash: url.hash,
      oneTimeParams: ONE_TIME_AUTH_PARAMS.filter((name) => url.searchParams.has(name)),
      pathname: url.pathname,
    };
  }).toEqual({ hash: "", oneTimeParams: [], pathname: "/auth/callback/" });
}

async function mockStaffWorkspace(page, role) {
  const fixture = testAuthFixture({
    id: role === "owner" ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333",
    email: `${role}@clearstep.example`,
    refreshToken: `test-${role}-refresh-token`,
  });
  await persistAuthSession(page, fixture);
  await mockAuthUser(page, fixture.user);
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

test("the public header distinguishes a signed-out visitor from a persisted account session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reject analytics" }).click();

  const publicNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(publicNavigation.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in/");
  await expect(publicNavigation.getByRole("link", { name: "Your account — signed in", exact: true })).toHaveCount(0);

  const fixture = testAuthFixture({
    id: "44444444-4444-4444-8444-444444444444",
    email: "customer@clearstep.example",
    refreshToken: "test-customer-refresh-token",
  });
  await persistAuthSession(page, fixture);
  await mockAuthUser(page, fixture.user);
  await page.reload();

  const accountLink = publicNavigation.getByRole("link", { name: "Your account — signed in", exact: true });
  await expect(accountLink).toBeVisible();
  await expect(accountLink).toHaveAttribute("href", "/account/");
  await expect(accountLink.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(publicNavigation.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("a matching PKCE flow callback confirms sign-in and redirects safely", async ({ page }) => {
  const flowId = "test-flow-1234";
  const verifier = "test-pkce-verifier";
  const verifierSlot = `${SUPABASE_SESSION_STORAGE_KEY}-flow-${flowId}-code-verifier`;
  const fixture = testAuthFixture({
    id: "55555555-5555-4555-8555-555555555555",
    email: "callback@clearstep.example",
    refreshToken: "test-callback-refresh-token",
  });
  let exchangeBody = null;

  await page.addInitScript(({ marker, slot, storedVerifier }) => {
    if (window.sessionStorage.getItem(marker)) return;
    window.localStorage.setItem(slot, JSON.stringify(storedVerifier));
    window.sessionStorage.setItem(marker, "seeded");
  }, { marker: "clearstep_pkce_test_seeded", slot: verifierSlot, storedVerifier: verifier });
  await page.route(AUTH_TOKEN_ENDPOINT, async (route) => {
    exchangeBody = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...fixture.session, user: fixture.user }),
    });
  });
  await mockAuthUser(page, fixture.user);

  await page.goto(`/auth/callback/?code=test-auth-code&sb_flow_id=${flowId}&next=%2Fclearstep%2F`);
  await expect(page.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
  await expectScrubbedCallbackUrl(page);
  expect(exchangeBody).toEqual({ auth_code: "test-auth-code", code_verifier: verifier });

  await page.waitForURL("**/clearstep/");
  await expect(page.evaluate((slot) => window.localStorage.getItem(slot), verifierSlot)).resolves.toBeNull();
});

test("an OAuth callback error offers a return-path-aware sign-in recovery", async ({ page }) => {
  await page.goto("/auth/callback/?error=access_denied&error_description=Google+sign-in+was+cancelled&next=%2Fclearstep%2F");

  const alert = page.getByRole("alert").filter({ hasText: "Sign-in needs attention" });
  await expect(alert).toContainText("Google sign-in was cancelled");
  await expectScrubbedCallbackUrl(page);
  const recoveryLink = alert.getByRole("link", { name: "Start sign-in again", exact: true });
  await expect(recoveryLink).toBeVisible();
  const recoveryHref = await recoveryLink.getAttribute("href");
  const recoveryUrl = new URL(recoveryHref, "http://127.0.0.1:3000");
  expect(recoveryUrl.pathname).toBe("/sign-in");
  expect(recoveryUrl.searchParams.get("next")).toBe("/clearstep/");
  await expectNoAxeViolations(page);
});

test("a slow PKCE callback keeps one safe restart action without exposing the destination", async ({ page }) => {
  const verifier = "test-slow-pkce-verifier";
  const legacyVerifierSlot = `${SUPABASE_SESSION_STORAGE_KEY}-code-verifier`;
  let releaseTokenResponse;
  let reportTokenRequest;
  const tokenResponseReleased = new Promise((resolve) => {
    releaseTokenResponse = resolve;
  });
  const tokenRequestReceived = new Promise((resolve) => {
    reportTokenRequest = resolve;
  });

  await page.addInitScript(({ slot, storedVerifier }) => {
    window.localStorage.setItem(slot, JSON.stringify(storedVerifier));
  }, { slot: legacyVerifierSlot, storedVerifier: verifier });
  await page.route(AUTH_TOKEN_ENDPOINT, async (route) => {
    reportTokenRequest(route.request());
    await tokenResponseReleased;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "request_cancelled", error_description: "Test request released." }),
    });
  });

  await page.goto("/auth/callback/?code=slow-auth-code&next=%2Fclearstep%2F");
  try {
    const tokenRequest = await tokenRequestReceived;
    expect(JSON.parse(tokenRequest.postData() || "{}")).toEqual({
      auth_code: "slow-auth-code",
      code_verifier: verifier,
    });
    await expectScrubbedCallbackUrl(page);
    await expect(page.getByRole("heading", { name: "This is taking longer than expected", exact: true })).toBeVisible({ timeout: 7_500 });

    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Check my account", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link")).toHaveCount(1);
    const restartLink = main.getByRole("link", { name: /start.*again/iu });
    const restartHref = await restartLink.getAttribute("href");
    const restartUrl = new URL(restartHref, "http://127.0.0.1:3000");
    expect(restartUrl.pathname).toBe("/sign-in");
    expect(restartUrl.searchParams.get("next")).toBe("/clearstep/");
  } finally {
    releaseTokenResponse();
  }
});

test("Google sign-in shows progress and navigates to the local PKCE authorize URL", async ({ page }) => {
  let releaseAuthorizeResponse;
  let reportAuthorizeRequest;
  const authorizeResponseReleased = new Promise((resolve) => {
    releaseAuthorizeResponse = resolve;
  });
  const authorizeRequestReceived = new Promise((resolve) => {
    reportAuthorizeRequest = resolve;
  });

  await page.route(`${AUTH_AUTHORIZE_ENDPOINT}**`, async (route) => {
    reportAuthorizeRequest(route.request());
    await authorizeResponseReleased;
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Google provider test</title><p>Provider navigation received.</p>",
    });
  });
  await page.goto("/sign-in/?next=%2Faccount");
  await page.getByRole("button", { name: "Reject analytics" }).click();

  const click = page.getByRole("button", { name: "Continue with Google", exact: true }).click({ noWaitAfter: true });
  try {
    await expect(page.getByRole("button", { name: "Opening Google…", exact: true })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText(/google/iu);
    const authorizeRequest = await authorizeRequestReceived;

    const authorizeUrl = new URL(authorizeRequest.url());
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(AUTH_AUTHORIZE_ENDPOINT);
    expect(authorizeUrl.searchParams.get("provider")).toBe("google");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("s256");
    const callback = new URL(authorizeUrl.searchParams.get("redirect_to"));
    expect(callback.origin).toBe("http://127.0.0.1:3000");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe("/account");
    expect(callback.searchParams.get("sb_flow_id")).toBeNull();
  } finally {
    releaseAuthorizeResponse();
  }
  await click;
  await page.waitForURL(`${AUTH_AUTHORIZE_ENDPOINT}**`);
});

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
