import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let workerPromise;

async function getWorker() {
  workerPromise ??= import(new URL(`../dist/server/index.js?customer-routes=${process.pid}-${Date.now()}`, import.meta.url).href)
    .then((module) => module.default);
  return workerPromise;
}

async function render(path) {
  const worker = await getWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public customer routes", async () => {
  const routes = [
    ["/workshops", "Choose a workshop that starts with real work"],
    ["/private-workshops", "A practical AI workshop shaped around your work"],
    ["/about", "AI should make the next step clearer"],
    ["/faq", "Everything you need before taking the next step"],
    ["/sign-in", "Sign in without another password"],
    ["/account", "Your workshops, all in one place"],
    ["/account/private-quote", "Your tailored workshop is ready"],
    ["/account/waitlist", "Your waitlist offer is ready"],
    ["/staff/invite", "Accept your workspace invitation"],
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of service"],
    ["/cancellation", "Cancellation policy"],
    ["/checkout/success", "your next clear step is underway"],
    ["/checkout/cancel", "Your booking wasn’t completed"],
  ];

  for (const [path, expectedText] of routes) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, path);
    assert.match(await response.text(), new RegExp(expectedText, "i"), path);
  }
});

test("publishes search discovery files without private account routes", async () => {
  const sitemapResponse = await render("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /https:\/\/www\.clearstep-ai\.nl\/workshops</);
  assert.doesNotMatch(sitemap, /\/account|\/checkout|\/sign-in|\/staff/);

  const robotsResponse = await render("/robots.txt");
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /Disallow:\s*\/staff\//i);
  assert.doesNotMatch(robots, /Disallow:\s*\/account/i);
  assert.doesNotMatch(robots, /Disallow:\s*\/admin/i);
  assert.match(robots, /Sitemap:\s*https:\/\/www\.clearstep-ai\.nl\/sitemap\.xml/i);
});

test("uses the finalized Supabase booking and analytics contracts", async () => {
  const [bookingSource, analyticsSource, checkoutSource, waitlistSource, staffInviteSource] = await Promise.all([
    readFile(new URL("../components/booking-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/checkout-status.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/waitlist-offer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/staff-invite-acceptance.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(bookingSource, /body:\s*\{\s*workshopSlug,\s*sessionRef:\s*sessionId\s*\}/);
  assert.match(analyticsSource, /functions\.invoke\("analytics-ingest"/);
  assert.match(checkoutSource, /\.from\("enrollments"\)/);
  assert.match(checkoutSource, /\.eq\("stripe_checkout_session_id",\s*sessionId\)/);
  assert.doesNotMatch(checkoutSource, /functions\.invoke\("checkout-status"/);
  assert.match(waitlistSource, /functions\.invoke\("create-checkout"/);
  assert.match(waitlistSource, /workshopSlug:\s*course\.slug[\s\S]*sessionRef:\s*session\.id[\s\S]*offerToken/);
  assert.match(staffInviteSource, /functions\.invoke\("staff-invite-accept"/);
  assert.match(staffInviteSource, /body:\s*\{\s*token\s*\}/);

  const accountSource = await readFile(new URL("../components/account-dashboard.tsx", import.meta.url), "utf8");
  assert.match(accountSource, /\.rpc\("my_enrollment_details"\)/);
  assert.doesNotMatch(accountSource, /\.from\("enrollments"\)/);

  const privateQuoteSource = await readFile(new URL("../components/private-quote-checkout.tsx", import.meta.url), "utf8");
  assert.match(privateQuoteSource, /functions\.invoke\("create-checkout"/);
  assert.match(privateQuoteSource, /body:\s*\{\s*quoteToken\s*\}/);
});

test("preserves the current Stripe success URL without exposing an unverified success state", async () => {
  const response = await render("/account/bookings?session=cs_test_clearstep");
  assert.ok([307, 308].includes(response.status));
  assert.match(response.headers.get("location") ?? "", /\/checkout\/success\?session_id=cs_test_clearstep$/);
});
