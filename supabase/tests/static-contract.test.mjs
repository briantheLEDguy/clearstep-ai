import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (relative) =>
  (await readFile(path.join(root, relative), "utf8")).replaceAll("\r\n", "\n");
const projectRoot = path.resolve(root, "..");

test("runtime hardening and later admin controls have ordered migrations", async () => {
  const migrations = (await readdir(path.join(root, "migrations"))).sort();
  assert.deepEqual(migrations, [
    "20260818130000_clearstep_core.sql",
    "20260818130050_operations_schema.sql",
    "20260818130100_booking_workflows.sql",
    "20260818130200_admin_analytics_automation.sql",
    "20260818130300_booking_maintenance_cron.sql",
    "20260818130400_seed_clearstep_catalog.sql",
    "20260818130500_runtime_security_hardening.sql",
    "20260818200414_admin_controls.sql",
  ]);
});

test("all planned Edge Function slugs exist and public functions disable JWT verification", async () => {
  const expected = [
    "create-checkout",
    "stripe-webhook",
    "join-waitlist",
    "private-workshop-request",
    "admin-catalog",
    "staff-invite",
    "staff-invite-accept",
    "google-oauth-start",
    "google-oauth-callback",
    "automation-worker",
    "analytics-ingest",
    "auth-send-email-hook",
  ];
  const entries = await readdir(path.join(root, "functions"), { withFileTypes: true });
  const actual = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  assert.deepEqual(actual.sort(), expected.sort());

  const config = await read("config.toml");
  for (const slug of [
    "stripe-webhook",
    "private-workshop-request",
    "google-oauth-callback",
    "automation-worker",
    "analytics-ingest",
    "auth-send-email-hook",
  ]) {
    assert.match(config, new RegExp(`\\[functions\\.${slug}\\]\\s+verify_jwt = false`, "u"));
  }
});

test("Stripe Checkout follows current API, dynamic methods, tax gate, and signature rules", async () => {
  const checkout = await read("functions/create-checkout/index.ts");
  const webhook = await read("functions/stripe-webhook/index.ts");
  const priceValidation = await read("functions/_shared/stripe.ts");
  assert.match(checkout, /apiVersion:\s*"2026-06-24\.dahlia"/u);
  assert.match(checkout, /integration_identifier:\s*"clearstep_[a-z]{8}"/u);
  assert.match(checkout, /\/checkout\/success\?session_id=\{CHECKOUT_SESSION_ID\}/u);
  assert.match(checkout, /\/checkout\/cancel\?workshop=\$\{encodeURIComponent/u);
  assert.doesNotMatch(checkout, /payment_method_types/u);
  assert.match(checkout, /STRIPE_AUTOMATIC_TAX_ENABLED/u);
  assert.match(checkout, /automaticTaxEnabled\s*\?\s*\{ automatic_tax/u);
  assert.match(webhook, /const rawBody = await req\.text\(\)/u);
  assert.match(webhook, /constructEventAsync\(\s*rawBody,/u);
  assert.match(webhook, /STRIPE_WEBHOOK_SIGNING_SECRET/u);
  assert.match(priceValidation, /price\.active/u);
  assert.match(priceValidation, /price\.currency\.toUpperCase\(\) !== expected\.currency/u);
  assert.match(priceValidation, /price\.unit_amount !== expected\.amountCents/u);
  assert.match(priceValidation, /price\.tax_behavior !== "inclusive"/u);
  assert.match(priceValidation, /productId !== expected\.productId/u);
});

test("verified Stripe processing failures are recorded durably without consuming retries", async () => {
  const webhook = await read("functions/stripe-webhook/index.ts");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  assert.match(runtime, /create table private\.stripe_webhook_failures/u);
  assert.match(runtime, /create or replace function public\.record_stripe_webhook_failure/u);
  assert.match(runtime, /on conflict \(stripe_event_id\) do update[\s\S]*attempts = private\.stripe_webhook_failures\.attempts \+ 1/u);
  assert.doesNotMatch(
    runtime.match(/create or replace function public\.record_stripe_webhook_failure[\s\S]*?\$\$;/u)?.[0] ?? "",
    /private\.stripe_webhook_events|status = 'processed'/u,
  );
  assert.match(webhook, /signatureVerified && verifiedEvent && !eventProcessingCompleted/u);
  assert.match(webhook, /"record_stripe_webhook_failure"/u);
  assert.match(webhook, /return handleError\(error\)/u);
});

test("database contract has RLS, explicit grants, atomic seats, idempotency, and queue locking", async () => {
  const migrations = (
    await Promise.all((await readdir(path.join(root, "migrations"))).sort().map((name) => read(`migrations/${name}`)))
  ).join("\n");

  for (const table of ["profiles", "courses", "workshop_sessions", "enrollments", "waitlist_entries"]) {
    assert.match(migrations, new RegExp(`alter table public\\.${table} enable row level security`, "u"));
  }
  assert.match(migrations, /grant select \([\s\S]*\) on public\.courses to anon, authenticated/u);
  assert.match(migrations, /grant select \([\s\S]*\) on public\.workshop_sessions to anon, authenticated/u);
  assert.match(migrations, /constraint enrollments_one_seat_per_user unique \(session_id, user_id\)/u);
  assert.match(migrations, /constraint seat_holds_one_per_user unique \(session_id, user_id\)/u);
  assert.match(migrations, /create unique index checkout_attempts_one_active_per_user_session_idx[\s\S]*where status in \('creating', 'open', 'payment_pending'\)/u);
  assert.match(migrations, /stripe_event_id text not null unique/u);
  assert.match(migrations, /on conflict \(stripe_event_id\) do nothing/u);
  assert.match(migrations, /for update skip locked/u);
  for (const operation of ["pgmq.send", "pgmq.read", "pgmq.set_vt", "pgmq.archive"]) {
    assert.match(migrations, new RegExp(operation.replace(".", "\\."), "u"));
  }
  assert.match(migrations, /brian@bncconsulting\.co/u);
  assert.doesNotMatch(migrations, /'operations'/u);
  assert.match(migrations, /All other staff activation must go[\s\S]*through public\.accept_staff_invite/u);
  assert.doesNotMatch(
    migrations,
    /where lower\(email::text\) = lower\(new\.email\)[\s\S]{0,250}status = 'active'/u,
  );
  assert.match(migrations, /revoke execute on function public\.process_stripe_event/u);
  assert.match(migrations, /grant execute on function public\.process_stripe_event[\s\S]*to service_role/u);
  assert.match(migrations, /create table private\.session_integrations/u);
  assert.doesNotMatch(
    migrations.match(/create table public\.workshop_sessions \([\s\S]*?\n\);/u)?.[0] ?? "",
    /google_event_id|meet_url/u,
  );
  for (const table of [
    "payment_records",
    "email_deliveries",
    "integration_health",
    "audit_logs",
    "analytics_daily",
  ]) {
    assert.match(migrations, new RegExp(`create table private\\.${table}`, "u"));
    assert.match(migrations, new RegExp(`alter table private\\.${table} enable row level security`, "u"));
  }
  assert.match(migrations, /occurred_at < now\(\) - interval '90 days'/u);
  assert.match(migrations, /now\(\) at time zone 'Europe\/Amsterdam'[\s\S]*interval '24 months'/u);
  assert.match(migrations, /clearstep-analytics-rollup-retention/u);
  assert.match(migrations, /create trigger courses_set_updated_at[\s\S]*execute function private\.set_updated_at/u);
  const updatedAtFunction = migrations.match(/create or replace function private\.set_updated_at\(\)[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.doesNotMatch(updatedAtFunction, /new\.email/u);
  assert.match(migrations, /grant execute on function private\.valid_course_agenda\(jsonb\)[\s\S]*to service_role/u);
  assert.match(migrations, /courses_published_public_outcomes_nonempty/u);
  assert.match(migrations, /courses_published_public_agenda_nonempty/u);
});

test("course text and list bounds match the server-rendered catalog contract", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const courses = core.match(/create table public\.courses \([\s\S]*?\n\);/u)?.[0] ?? "";
  const outcomes = core.match(/create or replace function private\.valid_course_outcomes[\s\S]*?\$\$;/u)?.[0] ?? "";
  const agenda = core.match(/create or replace function private\.valid_course_agenda[\s\S]*?\$\$;/u)?.[0] ?? "";

  assert.match(courses, /courses_title_bounds[\s\S]*length\(title\) <= 240/u);
  assert.match(courses, /courses_summary_bounds[\s\S]*length\(summary\) <= 1000/u);
  assert.match(courses, /courses_description_bounds[\s\S]*length\(description\) <= 10000/u);
  assert.match(courses, /courses_level_max_length[\s\S]*length\(level\) <= 120/u);
  assert.match(courses, /courses_audience_max_length[\s\S]*length\(audience\) <= 2000/u);
  assert.match(courses, /courses_outcomes_valid[\s\S]*private\.valid_course_outcomes\(outcomes\)/u);

  assert.match(outcomes, /cardinality\(p_outcomes\) > 20/u);
  assert.match(outcomes, /length\(outcome\) > 500/u);
  assert.match(outcomes, /length\(trim\(outcome\)\) not between 1 and 500/u);
  assert.match(agenda, /jsonb_array_length\(p_agenda\) > 20/u);
  assert.match(agenda, /length\(item ->> 'title'\) > 120/u);
  assert.match(agenda, /length\(item ->> 'detail'\) > 500/u);
  assert.match(agenda, /length\(trim\(item ->> 'title'\)\) not between 1 and 120/u);
  assert.match(agenda, /length\(trim\(item ->> 'detail'\)\) not between 1 and 500/u);
  assert.match(core, /grant execute on function private\.valid_course_outcomes\(text\[\]\)[\s\S]*to service_role/u);
});

test("public catalogue and account RPCs expose only role-safe data", async () => {
  const migrations = (
    await Promise.all((await readdir(path.join(root, "migrations"))).sort().map((name) => read(`migrations/${name}`)))
  ).join("\n");
  const catalogFunction = migrations.match(/create or replace function public\.public_workshop_catalog\(\)[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(catalogFunction, /'audience', c\.audience/u);
  assert.match(catalogFunction, /'agenda', c\.agenda/u);
  assert.match(catalogFunction, /'seats_left'/u);
  assert.match(catalogFunction, /c\.visibility = 'public'/u);
  assert.doesNotMatch(catalogFunction, /meet_url|google_event_id|attendee_email/u);
  assert.match(migrations, /grant execute on function public\.public_workshop_catalog\(\)[\s\S]*to anon, authenticated/u);

  const accountFunction = migrations.match(/create or replace function public\.my_enrollment_details\(\)[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(accountFunction, /v_user_id uuid := auth\.uid\(\)/u);
  assert.match(accountFunction, /where e\.user_id = v_user_id/u);
  assert.match(accountFunction, /case when e\.status = 'confirmed' then si\.meet_url else null end/u);
  assert.match(
    accountFunction,
    /e\.stripe_payment_intent_id is not null[\s\S]*p\.stripe_payment_intent_id = e\.stripe_payment_intent_id[\s\S]*or \([\s\S]*e\.stripe_payment_intent_id is null[\s\S]*p\.enrollment_id = e\.id/u,
  );
  assert.doesNotMatch(accountFunction, /where p\.enrollment_id = e\.id\s+or/u);
  assert.match(migrations, /revoke execute on function public\.my_enrollment_details\(\)[\s\S]*from public, anon/u);
  assert.match(migrations, /grant execute on function public\.my_enrollment_details\(\)[\s\S]*to authenticated/u);
});

test("checkout attempts and refunds remain financially idempotent", async () => {
  const migrations = (
    await Promise.all((await readdir(path.join(root, "migrations"))).sort().map((name) => read(`migrations/${name}`)))
  ).join("\n");
  const checkout = await read("functions/create-checkout/index.ts");
  assert.match(migrations, /ca\.status in \('creating', 'open', 'payment_pending'\)/u);
  assert.match(checkout, /existing\.status === "open" && existing\.url/u);
  assert.match(checkout, /existing\.status === "open"[\s\S]*checkout\.sessions\.expire/u);
  assert.match(checkout, /checkout_payment_pending/u);
  assert.match(migrations, /'charge\.refunded'/u);
  assert.match(migrations, /on conflict \(stripe_payment_intent_id\) do update/u);
  assert.match(migrations, /'stripe\.refund_recorded'/u);
  assert.match(migrations, /'stripe\.unmatched_refund_ignored'/u);
  assert.match(migrations, /clearstep_payment_not_found/u);
  assert.match(migrations, /checkout_amount_or_currency_mismatch/u);
  assert.match(migrations, /\(v_object ->> 'amount_total'\)::integer <> v_checkout\.amount_cents/u);
  assert.match(migrations, /upper\(coalesce\(v_object ->> 'currency', ''\)\) <> v_checkout\.currency/u);
  const webhook = migrations.match(/create or replace function public\.process_stripe_event[\s\S]*?\$\$;/u)?.[0] ?? "";
  const fullRefundCondition = "if v_payment.status = 'refunded'";
  const fullRefund = webhook.slice(
    webhook.indexOf(fullRefundCondition),
    webhook.indexOf("if not exists (", webhook.indexOf(fullRefundCondition)),
  );
  assert.match(fullRefund, /v_enrollment\.stripe_payment_intent_id = v_payment_intent_id/u);
  assert.match(fullRefund, /'calendar_enrollment_remove'/u);
  assert.match(fullRefund, /'calendar-enrollment-remove:' \|\| v_enrollment\.id::text \|\| ':' \|\| v_payment\.id::text/u);
  assert.equal((webhook.match(/'calendar_enrollment_remove'/gu) ?? []).length, 1);
  const automation = await read("migrations/20260818130200_admin_analytics_automation.sql");
  assert.match(automation, /v_job\.job_type in \('calendar_session', 'calendar_enrollment', 'calendar_enrollment_remove'\)[\s\S]*v_integration := 'google_calendar'/u);
  assert.match(automation, /if v_job\.job_type in \('calendar_session', 'calendar_enrollment'\) and p_output is not null/u);
});

test("late Stripe events cannot oversell an expired and reallocated seat", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const operations = await read("migrations/20260818130050_operations_schema.sql");
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const webhook = booking.match(/create or replace function public\.process_stripe_event[\s\S]*?\$\$;/u)?.[0] ?? "";
  const webhookEdge = await read("functions/stripe-webhook/index.ts");
  const email = await read("functions/_shared/email.ts");

  assert.match(core, /grace_expires_at timestamptz not null/u);
  assert.match(core, /checkout_attempts_grace_after_expiry/u);
  assert.match(core, /checkout_attempts_seat_grace_idx[\s\S]*where status in \('open', 'payment_pending'\)/u);
  assert.match(core, /'paid_unallocated'/u);
  assert.match(operations, /create or replace function private\.session_occupied_seats/u);
  assert.match(operations, /ca\.grace_expires_at > now\(\)/u);
  assert.match(operations, /'requires_refund'/u);
  assert.match(booking, /least\(v_hold\.expires_at \+ interval '15 minutes', v_session\.start_at\)/u);
  assert.match(webhook, /for update of s/u);
  assert.match(webhook, /v_occupied_other := private\.session_occupied_seats/u);
  assert.match(webhook, /v_occupied_other >= v_session\.capacity/u);
  assert.match(webhook, /'stripe\.' \|\| v_remediation_reason/u);
  assert.match(webhook, /'requires_refund'/u);
  assert.match(webhook, /'late_payment_refund_required'/u);
  assert.match(webhook, /'late_payment_refund_admin'/u);
  assert.match(webhook, /'stripe_refund_remediation'/u);
  assert.match(webhook, /'late_payment_capacity_conflict'/u);
  assert.match(webhook, /'post_start_payment_settlement'/u);
  assert.match(webhook, /'post_start_pending_payment'/u);
  assert.match(webhook, /'post_start_conflict', v_post_start_conflict/u);
  assert.match(webhook, /'remediation_reason', v_remediation_reason/u);
  assert.match(webhook, /v_requires_refund := v_target_status = 'confirmed'[\s\S]*v_payment\.status <> 'refunded'/u);
  assert.match(webhook, /remediation_checkout\.status = 'paid_unallocated'[\s\S]*remediation_payment\.status <> 'refunded'/u);
  assert.ok(
    webhook.indexOf("v_occupied_other >= v_session.capacity")
      < webhook.indexOf("insert into public.enrollments"),
    "the final capacity check must run before enrollment allocation",
  );
  assert.ok(
    webhook.indexOf("'late_payment_refund_required'")
      < webhook.indexOf("return jsonb_build_object(\n        'duplicate', false,\n        'processed', true,\n        'capacity_conflict'"),
    "refund remediation must be queued before the webhook acknowledges the conflict",
  );
  assert.match(admin, /status = 'open' and grace_expires_at <= now\(\)/u);
  assert.match(admin, /ca\.status = 'payment_pending'[\s\S]*ca\.grace_expires_at <= now\(\)/u);
  const pendingTimeout = admin.slice(
    admin.indexOf("for v_stale_checkout in"),
    admin.indexOf("with expired as (", admin.indexOf("for v_stale_checkout in")),
  );
  assert.match(pendingTimeout, /set status = 'failed'[\s\S]*status = 'payment_pending'/u);
  assert.match(pendingTimeout, /update private\.payment_records[\s\S]*status = 'failed'[\s\S]*status = 'pending'/u);
  assert.match(pendingTimeout, /update public\.enrollments[\s\S]*status = 'cancelled'[\s\S]*status = 'pending_payment'/u);
  assert.match(pendingTimeout, /update private\.seat_holds[\s\S]*status = 'released'/u);
  assert.match(pendingTimeout, /update private\.waitlist_offers[\s\S]*status = 'expired'/u);
  assert.match(pendingTimeout, /'template', 'payment_failed'/u);
  assert.match(pendingTimeout, /'template', 'payment_pending_timeout_admin'/u);
  assert.match(admin, /'stripe\.payment_pending_timed_out'/u);
  assert.match(admin, /'payment_pending_timeout_admin'/u);
  assert.match(admin, /'stale_payment_pending', v_stale_payment_pending/u);
  assert.equal((admin.match(/private\.session_occupied_seats\(v_session\.id\)/gu) ?? []).length, 4);
  assert.match(webhookEdge, /result\.requires_refund === true/u);
  assert.match(webhookEdge, /p_success: !amountMismatch && !refundRemediationRequired/u);
  assert.match(webhookEdge, /result\.remediation_reason/u);
  assert.match(webhookEdge, /payment_requires_refund/u);
  assert.match(email, /case "late_payment_refund_required"/u);
  assert.match(email, /case "late_payment_refund_admin"/u);
  assert.match(email, /case "payment_pending_timeout_admin"/u);
  const staleUnpaid = webhook.match(
    /if p_event_type = 'checkout\.session\.completed'[\s\S]*?'reason', 'stale_unpaid_terminal_checkout'[\s\S]*?\n[ ]{4}\);\n[ ]{2}end if;/u,
  )?.[0] ?? "";
  assert.match(staleUnpaid, /p_event_type = 'checkout\.session\.completed'/u);
  assert.doesNotMatch(staleUnpaid, /async_payment_succeeded/u);
});

test("public and quoted sales stay closed until Google Calendar provisioning succeeds", async () => {
  const operations = await read("migrations/20260818130050_operations_schema.sql");
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");

  const readiness = operations.match(/create or replace function private\.session_calendar_ready[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(readiness, /si\.google_event_id is not null/u);
  assert.match(readiness, /s\.format = 'in_person' or si\.meet_url is not null/u);
  assert.match(operations, /public_workshop_catalog[\s\S]*private\.session_calendar_ready\(s\.id\)/u);
  assert.match(booking, /create_checkout_hold[\s\S]*session_calendar_not_provisioned/u);
  assert.match(booking, /join_session_waitlist[\s\S]*session_calendar_not_provisioned/u);
  assert.match(booking, /resolve_private_quote_checkout[\s\S]*private\.session_calendar_ready\(v_quote\.session_id\)/u);
  const quoteSend = admin.slice(admin.indexOf("when 'quote_send'"), admin.indexOf("when 'analytics_summary'"));
  assert.match(quoteSend, /private\.session_calendar_ready\(s\.id\)/u);
  assert.equal((admin.match(/private\.session_calendar_ready\(s\.id\)/gu) ?? []).length, 3);
});

test("public function request contracts remain stable", async () => {
  const checkout = await read("functions/create-checkout/index.ts");
  const waitlist = await read("functions/join-waitlist/index.ts");
  const analytics = await read("functions/analytics-ingest/index.ts");
  for (const source of [checkout, waitlist]) {
    assert.match(source, /workshopSlug/u);
    assert.match(source, /sessionRef/u);
  }
  assert.match(analytics, /eventName/u);
  assert.match(analytics, /pagePath/u);
  assert.match(analytics, /properties/u);
});

test("private workshop requests consume honeypot and timing controls before database writes", async () => {
  const source = await read("functions/private-workshop-request/index.ts");
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const honeypot = source.indexOf('typeof body.website === "string" && body.website.trim()');
  const timing = source.indexOf("elapsedMs < 1_500");
  const write = source.indexOf('"submit_private_workshop_request"');
  assert.ok(honeypot >= 0 && timing > honeypot && write > timing);
  assert.match(source, /return ok\(\{ received: true \}, 201\)/u);
  assert.match(source, /!Number\.isFinite\(startedAt\)/u);
  assert.match(source, /elapsedMs > 24 \* 60 \* 60 \* 1_000/u);
  const requestTable = core.match(/create table private\.private_workshop_requests \([\s\S]*?\n\);/u)?.[0] ?? "";
  assert.doesNotMatch(requestTable, /request_fingerprint/u);
  assert.match(core, /create table private\.private_request_rate_limits/u);
  assert.match(booking, /pg_advisory_xact_lock/u);
  assert.match(booking, /private\.private_request_rate_limits/u);
  assert.match(admin, /delete from private\.private_request_rate_limits[\s\S]*interval '24 hours'/u);
});

test("privacy-first analytics never persist a raw IP or user agent", async () => {
  const source = await read("functions/analytics-ingest/index.ts");
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  assert.match(source, /requireUuid\(body\.anonymousId, "anonymousId"\)/u);
  assert.doesNotMatch(source, /user-agent|ANALYTICS_HASH_SALT/u);
  assert.match(source, /hmacSha256Hex[\s\S]*RATE_LIMIT_HASH_SALT/u);
  assert.match(source, /allowedEvents\.has\(body\.eventName\)/u);
  assert.match(source, /rateLimitWindowMs = 10 \* 60 \* 1_000/u);
  assert.match(source, /p_abuse_hash: abuseHash/u);
  assert.match(source, /eventPropertyKeys/u);
  assert.match(source, /checkout_confirmed: new Set\(\)/u);
  assert.match(source, /sanitizeAnalyticsProperties\(body\.eventName/u);
  assert.doesNotMatch(source, /"checkout_started"/u);
  assert.doesNotMatch(runtime, /'checkout_started'/u);
  for (const eventName of [
    "page_view",
    "course_view",
    "cta_private_workshop",
    "cta_workshops",
    "cta_private_request",
    "cta_workshop_detail",
    "waitlist_started",
    "checkout_confirmed",
    "private_quote_checkout_started",
    "waitlist_offer_checkout_started",
  ]) {
    assert.match(source, new RegExp(`"${eventName}"`, "u"));
    assert.match(runtime, new RegExp(`'${eventName}'`, "u"));
  }
  const analyticsTable = core.match(/create table private\.analytics_events \([\s\S]*?\n\);/u)?.[0] ?? "";
  assert.match(analyticsTable, /anonymous_id uuid/u);
  assert.doesNotMatch(analyticsTable, /request_fingerprint|abuse_hash|ip_address|user_agent/u);
  const finalIngest = runtime.match(/create or replace function public\.ingest_analytics_event[\s\S]*?\$\$;/u)?.[0] ?? "";
  const analyticsInsert = finalIngest.match(/insert into private\.analytics_events[\s\S]*?returning id into v_event_id/u)?.[0] ?? "";
  assert.doesNotMatch(analyticsInsert, /abuse_hash/u);
  assert.match(runtime, /create table private\.analytics_rate_limits/u);
  assert.match(runtime, /if v_rate_count > 120/u);
  assert.match(runtime, /delete from private\.analytics_rate_limits[\s\S]*expires_at <= now\(\)/u);
  assert.doesNotMatch(finalIngest, /'checkout_started'/u);
  assert.match(finalIngest, /v_properties - v_allowed_property_keys <> '\{\}'::jsonb/u);
  assert.match(finalIngest, /jsonb_typeof\(property\.value\) <> 'string'/u);
  assert.match(source, /sameOriginPathname/u);
  assert.match(source, /p_page_path: pagePath/u);
  assert.match(source, /p_referrer: referrerPath/u);
  assert.match(source, /sensitiveQueryParameter/u);
  assert.match(source, /sensitivePropertyKey/u);
  assert.doesNotMatch(source, /p_referrer:\s*req\.headers\.get\("referer"\)/u);
});

test("team, waitlist, and operations actions enforce the planned role boundary", async () => {
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  for (const marker of [
    "when 'staff_context'",
    "when 'staff_invites_list'",
    "when 'staff_invite_revoke'",
    "when 'staff_update'",
    "when 'waitlist_list'",
    "when 'waitlist_offer'",
    "when 'waitlist_remove'",
    "when 'operations_status'",
    "when 'automation_jobs_list'",
    "when 'automation_job_retry'",
    "when 'audit_list'",
  ]) assert.match(admin, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(admin, /last_active_owner_required/u);
  assert.match(admin, /'staff\.member_updated'/u);
  assert.match(admin, /'waitlist\.offer_created'/u);
  assert.match(admin, /create_staff_invite[\s\S]*staff_has_role\(p_actor_user_id, array\['owner'\]\)/u);
  assert.match(admin, /create_google_oauth_state[\s\S]*staff_has_role\(p_actor_user_id, array\['owner'\]\)/u);
  assert.match(admin, /v_role = 'analyst' and p_action not in \('analytics_summary', 'staff_context'\)/u);
  for (const action of ["catalog_list"]) {
    const start = admin.indexOf(`when '${action}'`);
    assert.ok(start >= 0, `${action} is missing`);
    assert.match(admin.slice(start, start + 500), /v_role not in \('owner', 'admin'\)/u);
  }
  for (const action of [
    "google_connection_status",
    "operations_status",
    "automation_jobs_list",
    "automation_job_retry",
    "audit_list",
  ]) {
    const start = admin.indexOf(`when '${action}'`);
    assert.ok(start >= 0, `${action} is missing`);
    assert.match(admin.slice(start, start + 500), /v_role <> 'owner'[\s\S]*staff_owner_required/u);
  }
});

test("owner and staff-invite invariants serialize concurrent changes", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  assert.match(
    core,
    /create unique index staff_invites_one_open_per_email_idx[\s\S]*lower\(email::text\)[\s\S]*accepted_at is null and revoked_at is null/u,
  );
  assert.match(admin, /clearstep\.staff-invite:/u);
  assert.match(core, /staff_invites_exact_seven_day_expiry[\s\S]*expires_at = created_at \+ interval '7 days'/u);
  assert.match(admin, /v_expires_at timestamptz := now\(\) \+ interval '7 days'/u);
  assert.doesNotMatch(admin, /p_expires_at > now\(\) \+ interval '14 days'/u);
  assert.match(admin, /clearstep\.active-owner-roster/u);
  const staffUpdate = admin.slice(admin.indexOf("when 'staff_update'"), admin.indexOf("when 'waitlist_list'"));
  const rosterLock = staffUpdate.indexOf("clearstep.active-owner-roster");
  const targetLock = staffUpdate.indexOf("for update");
  const ownerCount = staffUpdate.indexOf("select count(*) into v_active_owner_count");
  assert.ok(rosterLock >= 0 && targetLock > rosterLock && ownerCount > targetLock);
  assert.match(staffUpdate, /where user_id = p_actor_user_id and status = 'active'[\s\S]*staff_owner_required/u);
});

test("historical analytics combine retained daily rollups with recent raw events", async () => {
  const operations = await read("migrations/20260818130050_operations_schema.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  const rollup = operations.match(/create or replace function public\.rollup_and_retain_analytics[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(operations, /dimension text not null default ''/u);
  assert.match(operations, /primary key \(day, event_name, dimension\)/u);
  assert.match(operations, /on conflict \(day, event_name, dimension\) do update/u);
  assert.match(operations, /ae\.properties ->> 'course_slug'/u);
  assert.match(admin, /p_event_name = 'course_view'[\s\S]*v_properties ->> 'course_slug'[\s\S]*jsonb_build_object\('course_id', v_course_id\)/u);
  assert.match(runtime, /p_event_name = 'course_view'[\s\S]*v_properties ->> 'course_slug'[\s\S]*jsonb_build_object\('course_id', v_course_id\)/u);
  assert.match(rollup, /v_raw_start_day date :=[\s\S]*::date - 89/u);
  assert.equal((rollup.match(/ae\.occurred_at >= v_raw_start_at/gu) ?? []).length, 3);
  assert.doesNotMatch(rollup, /ae\.occurred_at >= now\(\) - interval '91 days'/u);
  assert.match(rollup, /occurred_at < now\(\) - interval '90 days'/u);
  assert.match(rollup, /now\(\) at time zone 'Europe\/Amsterdam'[\s\S]*interval '24 months'/u);
  assert.match(operations, /create or replace function private\.analytics_event_count/u);
  assert.match(operations, /create or replace function private\.analytics_top_courses/u);
  assert.match(operations, /create or replace function private\.analytics_utm_sources/u);
  assert.match(rollup, /'page_view_utm_source'[\s\S]*left\(lower\(trim\(ae\.utm_source\)\), 200\)/u);
  assert.match(operations, /from private\.analytics_daily ad/u);
  assert.match(operations, /from private\.analytics_events ae/u);
  assert.match(operations, /'course_id', ranked\.course_id/u);
  assert.match(operations, /'course_slug', ranked\.course_slug/u);
  assert.match(operations, /'course_title', ranked\.course_title/u);
  assert.match(admin, /'page_views', private\.analytics_event_count\('page_view', v_from, v_to\)/u);
  assert.match(admin, /'top_courses', private\.analytics_top_courses\(v_from, v_to, 10\)/u);
  assert.match(admin, /'utm_sources', private\.analytics_utm_sources\(v_from, v_to, 10\)/u);
  assert.match(admin, /'automation_failures',[\s\S]*private\.automation_jobs[\s\S]*status = 'failed'/u);
  assert.match(admin, /v_analytics_retention_start[\s\S]*interval '24 months'/u);
  assert.doesNotMatch(admin, /v_to - v_from > interval '366 days'/u);
});

test("foreign-key columns used by operational joins are indexed", async () => {
  const migrations = (
    await Promise.all((await readdir(path.join(root, "migrations"))).sort().map((name) => read(`migrations/${name}`)))
  ).join("\n");
  for (const index of [
    "courses_created_by_idx",
    "workshop_sessions_created_by_idx",
    "seat_holds_waitlist_entry_id_idx",
    "private_requests_owner_user_id_idx",
    "private_quotes_created_by_idx",
    "private_quotes_customer_user_id_idx",
    "staff_members_invited_by_idx",
    "staff_invites_invited_by_idx",
    "google_oauth_states_actor_user_id_idx",
    "google_connections_connected_by_idx",
    "payment_records_checkout_attempt_id_idx",
    "calendar_session_leases_automation_job_idx",
    "google_connections_access_token_secret_idx",
    "google_connections_refresh_token_secret_idx",
  ]) assert.match(migrations, new RegExp(`create index ${index}\\b`, "u"));
});

test("published inventory is sellable and session edits preserve occupied booking identity", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const operations = await read("migrations/20260818130050_operations_schema.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const seed = await read("migrations/20260818130400_seed_clearstep_catalog.sql");
  const sessionUpsert = admin.slice(admin.indexOf("when 'session_upsert'"), admin.indexOf("when 'private_requests_list'"));

  assert.match(core, /courses_published_stripe_required[\s\S]*stripe_product_id is not null[\s\S]*stripe_price_id is not null/u);
  assert.match(core, /scheduled_session_requires_sellable_course/u);
  assert.match(operations, /public_workshop_catalog[\s\S]*c\.stripe_product_id is not null[\s\S]*c\.stripe_price_id is not null/u);
  assert.match(admin, /published_course_requires_stripe_price/u);
  assert.doesNotMatch(seed, /'published'|'scheduled'/u);

  const lockAt = sessionUpsert.indexOf("for update");
  const capacityAt = sessionUpsert.indexOf("session_capacity_below_occupied");
  const updateAt = sessionUpsert.indexOf("update public.workshop_sessions");
  assert.ok(lockAt >= 0 && capacityAt > lockAt && updateAt > capacityAt);
  assert.match(sessionUpsert, /private\.session_occupied_seats\(v_session\.id\)/u);
  assert.match(sessionUpsert, /v_has_paid_enrollment/u);
  assert.match(sessionUpsert, /occupied_session_status_immutable/u);
  assert.match(sessionUpsert, /v_used > 0 or v_has_paid_enrollment/u);
  assert.match(sessionUpsert, /is distinct from[\s\S]*occupied_session_identity_immutable/u);
});

test("checkout, waitlist, and quote windows honor start time, FIFO, and token revisions", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  const checkout = booking.match(/create or replace function public\.create_checkout_hold[\s\S]*?\$\$;/u)?.[0] ?? "";
  const offer = admin.slice(admin.indexOf("when 'waitlist_offer'"), admin.indexOf("when 'waitlist_remove'"));
  const quoteSend = admin.slice(admin.indexOf("when 'quote_send'"), admin.indexOf("when 'analytics_summary'"));

  assert.match(core, /seat_hold_must_expire_before_session_start/u);
  assert.match(core, /checkout_must_settle_by_session_start/u);
  assert.match(core, /waitlist_offer_exceeds_booking_deadline/u);
  assert.match(checkout, /v_booking_deadline_at := v_session\.start_at - interval '32 minutes'/u);
  assert.match(checkout, /'checkout_expires_at', v_checkout\.expires_at/u);
  assert.match(checkout, /'booking_deadline_at', v_booking_deadline_at/u);
  assert.match(checkout, /now\(\) \+ interval '31 minutes'[\s\S]*v_session\.start_at - interval '1 minute'[\s\S]*v_offer\.expires_at/u);
  assert.match(checkout, /v_hold_expires_at <= now\(\) \+ interval '30 minutes'[\s\S]*waitlist_offer_expiring/u);
  assert.match(runtime, /grace_expires_at = least\([\s\S]*v_effective_expires_at \+ interval '15 minutes'[\s\S]*start_at/u);

  assert.match(offer, /status = 'waiting'[\s\S]*for update/u);
  assert.match(offer, /\(fifo_head\.joined_at, fifo_head\.id\) < \(v_entry\.joined_at, v_entry\.id\)/u);
  assert.match(offer, /waitlist_fifo_head_required/u);
  assert.match(offer, /v_session\.start_at - interval '32 minutes'/u);

  const quoteLock = quoteSend.indexOf("for update");
  const tokenGeneration = quoteSend.indexOf("extensions.gen_random_bytes");
  assert.ok(quoteLock >= 0 && tokenGeneration > quoteLock);
  assert.match(quoteSend, /v_session\.start_at - interval '1 minute'/u);
  assert.match(quoteSend, /'private-quote:' \|\| v_quote\.id::text \|\| ':' \|\| v_checkout_token_hash/u);
});

test("reverse Stripe delivery and refund repurchase use distinct terminal lifecycles", async () => {
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const webhook = booking.match(/create or replace function public\.process_stripe_event[\s\S]*?\$\$;/u)?.[0] ?? "";
  const staleAt = webhook.indexOf("stale_unpaid_terminal_checkout");
  const allocationAt = webhook.indexOf("insert into public.enrollments");

  assert.ok(staleAt >= 0 && staleAt < allocationAt);
  assert.match(webhook, /p_event_type = 'checkout\.session\.completed'[\s\S]*payment_status[\s\S]*v_checkout\.status in \('failed', 'expired'\)/u);
  assert.match(webhook, /p_event_type = 'checkout\.session\.async_payment_succeeded'/u);
  assert.match(webhook, /amount_cents = excluded\.amount_cents/u);
  assert.match(webhook, /booked_at = case[\s\S]*public\.enrollments\.status in \('cancelled', 'refunded'\)[\s\S]*then now\(\)/u);
  assert.match(webhook, /confirmed_at = case[\s\S]*when excluded\.status = 'confirmed'[\s\S]*then now\(\)/u);
  for (const prefix of ["enrollment-confirmation", "booking-admin-alert", "calendar-enrollment"]) {
    assert.match(webhook, new RegExp(`'${prefix}:' \\|\\| v_enrollment\\.id::text \\|\\| ':' \\|\\| v_checkout\\.id::text`, "u"));
  }
  assert.match(webhook, /status = 'removed'[\s\S]*where session_id = v_enrollment\.session_id[\s\S]*status = 'accepted'/u);
  assert.match(booking, /waitlist-joined:' \|\| v_entry\.id::text \|\| ':'[\s\S]*v_entry\.joined_at/u);
});

test("private quotes are hidden, token-bound, and receive a server-owned payment link", async () => {
  const core = await read("migrations/20260818130000_clearstep_core.sql");
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const adminSql = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const adminEdge = await read("functions/admin-catalog/index.ts");
  const checkout = await read("functions/create-checkout/index.ts");
  const catalog = await read("functions/_shared/catalog.ts");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  assert.match(core, /visibility text not null default 'public'/u);
  assert.match(core, /using \(status = 'published' and visibility = 'public'\)/u);
  assert.match(adminSql, /'private'[\s\S]*'published'/u);
  assert.match(booking, /resolve_private_quote_checkout/u);
  assert.match(booking, /lower\(r\.email::text\) = lower\(trim\(p_user_email\)\)/u);
  assert.match(checkout, /p_token_hash: await sha256Hex\(quoteToken\)/u);
  assert.match(checkout, /create_private_quote_checkout_hold/u);
  assert.match(checkout, /existing\.expires_at \* 1_000 > checkoutDeadlineMs/u);
  assert.match(checkout, /Math\.min\([\s\S]*holdExpiresAtMs,[\s\S]*databaseCheckoutExpiresAtMs,[\s\S]*sessionStartsAtMs,[\s\S]*quoteExpiresAtMs/u);
  assert.match(checkout, /databaseCheckoutExpiresAtMs > quoteExpiresAtMs/u);
  assert.match(runtime, /create or replace function public\.create_private_quote_checkout_hold/u);
  assert.match(runtime, /checkout_expires_at <= now\(\) \+ interval '31 minutes'/u);
  assert.match(runtime, /least\([\s\S]*v_quote\.checkout_expires_at/u);
  assert.match(adminEdge, /payment_url_base: `\$\{env\("PUBLIC_SITE_URL"\)[\s\S]*\/account\/private-quote`/u);
  assert.doesNotMatch(adminEdge, /payment_url_base:\s*payload\.payment_url_base/u);
  assert.match(catalog, /\.eq\("courses\.visibility", "public"\)/u);
});

test("catalog seed uses the fixed public session references and keeps Stripe gated", async () => {
  const seed = await read("migrations/20260818130400_seed_clearstep_catalog.sql");
  for (const [slug, sessionRef] of [
    ["make-ai-useful", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
    ["clearer-content-with-ai", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"],
    ["simplify-admin-with-ai", "cccccccc-cccc-4ccc-8ccc-ccccccccccc3"],
  ]) {
    assert.match(seed, new RegExp(slug, "u"));
    assert.match(seed, new RegExp(sessionRef, "u"));
  }
  assert.doesNotMatch(seed, /'price_[A-Za-z0-9]+'/u);
  assert.match(seed, /stripe_price_id[\s\S]*null/u);
  assert.match(seed, /'calendar_session'/u);
  for (const price of [14900, 12900]) assert.match(seed, new RegExp(`\\b${price}\\b`, "u"));
  for (const capacity of [10, 14]) assert.match(seed, new RegExp(`\\b${capacity}\\b`, "u"));
  assert.match(seed, /'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'[\s\S]*'in_person'[\s\S]*'Utrecht'/u);
});

test("Google automation targets the dedicated calendar and provisions sessions before enrollment", async () => {
  const google = await read("functions/_shared/google.ts");
  const worker = await read("functions/automation-worker/index.ts");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  assert.match(google, /GOOGLE_CALENDAR_ID/u);
  assert.doesNotMatch(google, /calendars\/primary/u);
  assert.match(worker, /calendar_session/u);
  assert.match(worker, /calendar_enrollment/u);
  assert.match(worker, /calendar_enrollment_remove/u);
  assert.match(google, /removeCalendarEnrollment/u);
  assert.equal((google.match(/guestsCanSeeOtherGuests:\s*false/gu) ?? []).length, 3);
  assert.equal((google.match(/guestsCanInviteOthers:\s*false/gu) ?? []).length, 3);
  assert.equal((google.match(/guestsCanModify:\s*false/gu) ?? []).length, 3);
  assert.match(runtime, /create table private\.calendar_session_leases/u);
  assert.match(worker, /acquire_calendar_session_lease/u);
  assert.match(worker, /finally[\s\S]*release_calendar_session_lease/u);
  assert.match(runtime, /create or replace function public\.resolve_calendar_session_job/u);
  const sessionResolver = runtime.match(/create or replace function public\.resolve_calendar_session_job[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(sessionResolver, /from public\.workshop_sessions s[\s\S]*join public\.courses c/u);
  assert.match(sessionResolver, /s\.updated_at as conference_revision/u);
  assert.match(sessionResolver, /'conference_revision', v_session\.conference_revision/u);
  assert.match(sessionResolver, /'should_apply', v_session\.status in \('draft', 'scheduled', 'sold_out'\)/u);
  const enrollmentResolver = runtime.match(/create or replace function public\.resolve_calendar_enrollment_job[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(enrollmentResolver, /s\.updated_at as conference_revision/u);
  assert.match(enrollmentResolver, /'conference_revision', v_session\.conference_revision/u);
  assert.ok(worker.indexOf('"resolve_calendar_session_job"') < worker.indexOf("upsertCalendarSession("));
  assert.doesNotMatch(worker, /upsertCalendarSession\([\s\S]{0,180}job\.payload/u);
  assert.doesNotMatch(worker, /upsertCalendarEnrollment\([\s\S]{0,180}job\.payload/u);
  assert.match(worker, /conference_revision: enrollment\.conference_revision/u);
  assert.match(worker, /start_at: enrollment\.start_at[\s\S]*format: enrollment\.format/u);
  assert.match(worker, /"apply_calendar_integration_state"/u);
  const integrationState = runtime.match(/create or replace function public\.apply_calendar_integration_state[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(integrationState, /meet_url = excluded\.meet_url/u);
  assert.doesNotMatch(integrationState, /meet_url = coalesce/u);
  assert.match(google, /body\.conferenceData = null/u);
  assert.match(google, /google_conference_removal_pending/u);
  assert.match(
    google,
    /conferenceRequestId\(\s*payload\.session_id,\s*payload\.conference_revision,\s*\)/u,
  );
  assert.match(
    google,
    /conferenceRequestId\(\s*payload\.session_id,\s*conferenceRevision,\s*\)/u,
  );
  assert.match(google, /sha256Hex\(`\$\{sessionId\}:\$\{conferenceRevision\}`\)/u);
  assert.doesNotMatch(google, /function conferenceRequestId\(sessionId: string\):/u);
  assert.match(google, /createRequest\?: \{[\s\S]*requestId\?: string/u);
  assert.match(google, /conferenceRecoveryRevision\(event, payload\)/u);
  assert.match(
    google,
    /failureFingerprint = event\.conferenceData\?\.createRequest\?\.requestId\?\.trim\(\) \|\|[\s\S]*event\.etag\?\.trim\(\)/u,
  );
  assert.match(
    google,
    /`\$\{payload\.conference_revision\}:recovery:\$\{failureFingerprint\}`/u,
  );
  assert.match(google, /statusCode\?: "pending" \| "success" \| "failure"/u);
  assert.match(google, /google_conference_pending/u);
  assert.match(google, /google_conference_failed/u);
  assert.match(google, /meet_url: requireReadyConference\(created, payload\)/u);
});

test("full refunds remove only the refunded attendee and stale enrollment adds are skipped", async () => {
  const booking = await read("migrations/20260818130100_booking_workflows.sql");
  const admin = await read("migrations/20260818130200_admin_analytics_automation.sql");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  const google = await read("functions/_shared/google.ts");
  const worker = await read("functions/automation-worker/index.ts");
  const fullRefundStart = booking.indexOf("if v_payment.status = 'refunded'");
  const fullRefund = booking.slice(fullRefundStart, booking.indexOf("if not exists (", fullRefundStart));
  assert.match(fullRefund, /'calendar_enrollment_remove'/u);
  assert.match(fullRefund, /'calendar-enrollment-remove:' \|\| v_enrollment\.id/u);
  assert.match(admin, /v_job\.job_type in \('calendar_session', 'calendar_enrollment', 'calendar_enrollment_remove'\)/u);
  assert.match(runtime, /job_type in \('calendar_session', 'calendar_enrollment', 'calendar_enrollment_remove'\)/u);
  assert.match(runtime, /when v_job\.job_type = 'calendar_enrollment'[\s\S]*v_enrollment\.status = 'confirmed'/u);
  assert.match(runtime, /when v_job\.job_type = 'calendar_enrollment_remove'[\s\S]*v_enrollment\.status = 'refunded'/u);
  assert.match(worker, /job\.job_type === "calendar_enrollment_remove"/u);
  assert.match(worker, /resolve_calendar_enrollment_job/u);
  assert.match(google, /attendees = \(event\.attendees \?\? \[\]\)\.filter/u);
  assert.match(google, /attendee\.email\.toLowerCase\(\) !== target/u);
  assert.match(google, /if \(attendees\.length === \(event\.attendees \?\? \[\]\)\.length\)/u);
  assert.match(google, /headers\["if-match"\] = event\.etag/u);
});

test("Google credentials use Vault and Gmail distinguishes safe rejection retries from ambiguous delivery", async () => {
  const google = await read("functions/_shared/google.ts");
  const crypto = await read("functions/_shared/crypto.ts");
  const worker = await read("functions/automation-worker/index.ts");
  const adminEdge = await read("functions/admin-catalog/index.ts");
  const adminUi = await readFile(path.join(projectRoot, "components", "admin", "AdminDashboard.tsx"), "utf8");
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  const rootEnv = await readFile(path.join(projectRoot, ".env.example"), "utf8");
  const backendEnv = await read(".env.example");
  assert.match(runtime, /create extension if not exists supabase_vault with schema vault/u);
  assert.match(runtime, /vault\.create_secret/u);
  assert.match(runtime, /vault\.update_secret/u);
  assert.match(runtime, /vault\.decrypted_secrets/u);
  assert.match(runtime, /drop column encrypted_access_token/u);
  assert.match(runtime, /drop column encrypted_refresh_token/u);
  assert.doesNotMatch(google, /encryptSecret|decryptSecret|p_encrypted|encrypted_access_token/u);
  assert.doesNotMatch(crypto, /AES-GCM|GOOGLE_TOKEN_ENCRYPTION_KEY/u);
  assert.doesNotMatch(`${rootEnv}\n${backendEnv}`, /GOOGLE_TOKEN_ENCRYPTION_KEY/u);
  for (const rpcName of [
    "inspect_email_delivery",
    "begin_email_delivery",
    "mark_email_delivery_sent",
    "fail_uncertain_email_job",
    "retry_unsent_email_job",
  ]) {
    assert.match(worker, new RegExp(`"${rpcName}"`, "u"));
    assert.match(runtime, new RegExp(`function public\\.${rpcName}`, "u"));
  }
  const sendCall = "await sendPreparedGoogleEmail(ctx.supabaseAdmin, prepared)";
  assert.ok(worker.indexOf('"begin_email_delivery"') < worker.indexOf(sendCall));
  assert.ok(worker.indexOf(sendCall) < worker.indexOf('"mark_email_delivery_sent"'));
  assert.match(google, /Message-ID:/u);
  assert.match(google, /class GoogleEmailHttpError extends Error/u);
  assert.match(google, /response\.status === 401[\s\S]*getAccessToken\(admin, true\)[\s\S]*response = await send\(refreshed\.accessToken\)/u);
  assert.match(google, /response\.status === 429 \|\| response\.status >= 500/u);
  assert.match(google, /retryAfterSeconds\(response\.headers\.get\("retry-after"\)\)/u);
  assert.match(worker, /isKnownUnsentGoogleEmailError\(jobError\)[\s\S]*"retry_unsent_email_job"/u);
  assert.match(runtime, /create or replace function public\.retry_unsent_email_job/u);
  assert.match(runtime, /when not p_retryable or v_job\.attempts >= v_job\.max_attempts then 'failed'/u);
  assert.match(runtime, /pgmq\.set_vt\('clearstep_automation', v_job\.pgmq_message_id, v_retry_delay\)/u);
  assert.match(runtime, /status in \('sending', 'sent', 'uncertain', 'retrying', 'failed'\)/u);
  assert.match(runtime, /pgmq\.archive\('clearstep_automation'/u);
  assert.match(runtime, /create or replace function public\.reconcile_email_delivery/u);
  assert.match(runtime, /staff_has_role\(p_actor_user_id, array\['owner'\]\)/u);
  assert.match(runtime, /p_resolution not in \('confirm_sent', 'retry_unsent'\)/u);
  assert.match(runtime, /job_type <> 'email'/u);
  assert.match(adminEdge, /"list_automation_jobs_with_delivery_state"/u);
  assert.match(adminEdge, /"retry_non_email_automation_job"/u);
  assert.match(adminEdge, /"reconcile_email_delivery"/u);
  assert.match(adminUi, /Check the Gmail Sent folder first/u);
  assert.match(adminUi, /Verified unsent—retry/u);
});

test("delivered email jobs redact raw action links while failed recovery has bounded retention", async () => {
  const runtime = await read("migrations/20260818130500_runtime_security_hardening.sql");
  const redact = runtime.match(/create or replace function private\.redact_automation_payload[\s\S]*?\$\$;/u)?.[0] ?? "";
  for (const sensitiveKey of ["invite_url", "offer_token", "payment_url", "quote_token", "checkout_token"]) {
    assert.match(redact, new RegExp(`'${sensitiveKey}'`, "u"));
  }
  assert.match(runtime, /create trigger automation_jobs_redact_terminal_payload/u);
  const redactTrigger = runtime.match(/create or replace function private\.redact_terminal_automation_job[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(redactTrigger, /new\.status in \('completed', 'cancelled'\)/u);
  assert.doesNotMatch(redactTrigger, /'failed'/u);
  const markSent = runtime.match(/create or replace function public\.mark_email_delivery_sent[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(markSent, /set payload = private\.redact_automation_payload\(payload\)/u);
  const reconcile = runtime.match(/create or replace function public\.reconcile_email_delivery[\s\S]*?\$\$;/u)?.[0] ?? "";
  assert.match(reconcile, /p_resolution = 'confirm_sent'[\s\S]*payload = private\.redact_automation_payload\(payload\)/u);
  assert.match(reconcile, /email_sensitive_payload_expired/u);
  assert.match(runtime, /created_at <= now\(\) - interval '31 days'/u);
  assert.match(runtime, /payload ->> 'offer_expires_at'/u);
  assert.match(runtime, /payload ->> 'expires_at'/u);
  assert.match(runtime, /payload ->> 'valid_until'/u);
});

test("auth email links verify through Supabase and return only to the app PKCE callback", async () => {
  const email = await read("functions/_shared/email.ts");
  assert.match(email, /new URL\("\/auth\/v1\/verify", env\("SUPABASE_URL"\)\)/u);
  assert.match(email, /new URL\("\/auth\/callback", appBase\)/u);
  assert.match(email, /requested\.origin === appBase\.origin/u);
  assert.match(email, /requested\.pathname === "\/auth\/callback"/u);
  assert.match(email, /action === "reauthentication"[\s\S]*verification code/u);
});

test("checkout success is read-only and enrollment remains webhook-owned", async () => {
  const status = await readFile(path.join(projectRoot, "components", "checkout-status.tsx"), "utf8");
  assert.match(status, /\.from\("enrollments"\)[\s\S]*\.select\(/u);
  assert.doesNotMatch(status, /\.insert\(|\.update\(|\.upsert\(|process_stripe_event/u);
});

test("no real-looking provider secret is committed in executable backend files", async () => {
  const functionDirs = await readdir(path.join(root, "functions"), { withFileTypes: true });
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  }
  for (const entry of functionDirs) if (entry.isDirectory()) await collect(path.join(root, "functions", entry.name));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/u);
  assert.doesNotMatch(source, /whsec_[A-Za-z0-9]{20,}/u);
});

test("all Edge Function TypeScript files parse", async () => {
  const ts = await import("typescript");
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  }
  await collect(path.join(root, "functions"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const result = ts.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        allowImportingTsExtensions: true,
      },
    });
    const errors = (result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    assert.equal(errors.length, 0, `${file}: ${errors.map((error) => error.messageText).join("; ")}`);
  }
});
