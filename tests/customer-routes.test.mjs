import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function exported(path) {
  const pathname = path.split("?", 1)[0];
  const relative = pathname === "/" ? "index.html" : `${pathname.slice(1)}/index.html`;
  return readFile(new URL(`../out/${relative}`, import.meta.url), "utf8");
}

test("exports the public customer routes", async () => {
  const routes = [
    ["/clearstep", "Make AI useful"],
    ["/clearstep/workshops", "Choose a workshop that starts with real work"],
    ["/clearstep/private-workshops", "A practical AI workshop shaped around your work"],
    ["/clearstep/about", "AI should make the next step clearer"],
    ["/clearstep/faq", "Everything you need before taking the next step"],
    ["/clearstep/guides", "Guides"],
    ["/plate-and-post", "Content made to be craved"],
    ["/plate-and-post/services", "Choose the content package your brand needs"],
    ["/plate-and-post/about", "Product content with a food-first point of view"],
    ["/plate-and-post/faq", "Questions before you book Plate &amp; Post"],
    ["/plate-and-post/services/basic-product-shoot", "Plate &amp; Post package"],
    ["/plate-and-post/services/video-content", "Plate &amp; Post package"],
    ["/plate-and-post/services/combo-package", "Plate &amp; Post package"],
    ["/sign-in", "Sign in without another password"],
    ["/account", "Your bookings and service orders, all in one place"],
    ["/account/private-quote", "Your tailored workshop is ready"],
    ["/account/waitlist", "Your waitlist offer is ready"],
    ["/staff/invite", "Accept your workspace invitation"],
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of service"],
    ["/cancellation", "Cancellation policy"],
    ["/complaints", "Complaints procedure"],
    ["/checkout/success", "Checking your payment return"],
    ["/checkout/cancel", "Checkout cancelled"],
  ];

  for (const [path, expectedText] of routes) {
    assert.match(await exported(path), new RegExp(expectedText, "i"), path);
  }
});

test("does not duplicate the retired root Clearstep marketing routes", async () => {
  for (const path of ["/workshops", "/private-workshops", "/about", "/faq", "/guides"]) {
    await assert.rejects(exported(path), { code: "ENOENT" }, path);
  }
});

test("publishes search discovery files without private account routes", async () => {
  const sitemap = await readFile(new URL("../out/sitemap.xml", import.meta.url), "utf8");
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/clearstep\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/clearstep\/workshops\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/plate-and-post\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/plate-and-post\/services\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/plate-and-post\/about\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/plate-and-post\/faq\/<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.bncconsulting\.nl\/complaints\/<\/loc>/);
  assert.doesNotMatch(sitemap, /https:\/\/www\.clearstep-ai\.nl|https:\/\/www\.bncconsulting\.nl\/(?:workshops|private-workshops|about|faq|guides)\/<\/loc>/);
  assert.doesNotMatch(sitemap, /\/account|\/checkout|\/sign-in|\/staff|\/clearstep\/guides/);

  const robots = await readFile(new URL("../out/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /Disallow:\s*\/staff\//i);
  assert.doesNotMatch(robots, /Disallow:\s*\/account/i);
  assert.doesNotMatch(robots, /Disallow:\s*\/admin/i);
  assert.match(robots, /Sitemap:\s*https:\/\/www\.bncconsulting\.nl\/sitemap\.xml/i);
});

test("publishes concise company details and complaints guidance without approval messaging", async () => {
  const [privacy, terms, cancellation, complaints] = await Promise.all([
    exported("/privacy"),
    exported("/terms"),
    exported("/cancellation"),
    exported("/complaints"),
  ]);

  for (const policyPage of [privacy, terms, cancellation, complaints]) {
    assert.doesNotMatch(policyPage, /Legal information pending approval/i);
  }

  for (const contactPage of [privacy, terms, complaints]) {
    const renderedText = contactPage.replaceAll("<!-- -->", "");
    assert.match(renderedText, /BNC Consulting B\.V\./);
    assert.match(renderedText, /KVK:\s*94453047/);
    assert.match(renderedText, /VAT ID:\s*NL866783210B01/);
    assert.match(renderedText, /\+31\s*6\s*44044025/);
    assert.match(renderedText, /brian@bncconsulting\.co/);
  }

  assert.match(complaints, /acknowledge your complaint/i);
  assert.match(complaints, /substantive response within 14 days/i);
});

test("uses the finalized Supabase booking and analytics contracts", async () => {
  const [bookingSource, analyticsSource, checkoutSource, waitlistSource, staffInviteSource] = await Promise.all([
    readFile(new URL("../components/booking-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/checkout-status.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/waitlist-offer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/staff-invite-acceptance.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(bookingSource, /workshopSlug,\s*sessionRef:\s*sessionId/u);
  assert.match(bookingSource, /legalAccepted:\s*true/u);
  assert.match(analyticsSource, /fetch\(endpoint\.url/);
  assert.match(analyticsSource, /apikey: endpoint\.key/);
  assert.match(analyticsSource, /credentials: "omit"/);
  assert.doesNotMatch(analyticsSource, /getSupabaseBrowserClient|authorization/i);
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
  assert.match(privateQuoteSource, /body:\s*\{\s*targetType:\s*"private_quote",\s*quoteToken,\s*legalAccepted:\s*true\s*\}/);
});

test("preserves the legacy Stripe success URL as a workshop result", async () => {
  const source = await readFile(new URL("../components/query-routed-content.tsx", import.meta.url), "utf8");
  assert.match(source, /searchParams\.get\("session"\)/u);
  assert.match(source, /`\/checkout\/success\?session_id=\$\{encodeURIComponent\(sessionId\)\}&target=workshop`/u);
  assert.match(source, /window\.location\.replace\(destination\)/u);
});
