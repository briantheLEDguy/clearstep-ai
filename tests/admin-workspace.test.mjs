import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardUrl = new URL("../components/admin/AdminDashboard.tsx", import.meta.url);
const gateUrl = new URL("../components/admin/AdminGate.tsx", import.meta.url);
const apiUrl = new URL("../lib/admin/admin-api.ts", import.meta.url);
const adminFunctionUrl = new URL("../supabase/functions/admin-catalog/index.ts", import.meta.url);
const adminNavUrl = new URL("../components/admin/AdminNavLink.tsx", import.meta.url);
const adminControlsMigrationUrl = new URL("../supabase/migrations/20260818200414_admin_controls.sql", import.meta.url);

test("staff workspace is gated by a verified Supabase user and server-side membership action", async () => {
  const gate = await readFile(gateUrl, "utf8");

  assert.match(gate, /supabase\.auth\.getUser\(\)/);
  assert.match(gate, /invokeAdmin\(supabase, "analytics_summary"/);
  assert.match(gate, /staff_access_required/);
  assert.match(gate, /<AdminDashboard viewer=\{state\.viewer\}/);
  assert.doesNotMatch(gate, /user_metadata|service_role|SUPABASE_SERVICE/);
});

test("admin API unwraps Edge envelopes and reports server-provided errors", async () => {
  const api = await readFile(apiUrl, "utf8");

  assert.match(api, /client\.functions\.invoke\("admin-catalog"/);
  assert.match(api, /body: \{ action, payload \}/);
  assert.match(api, /context\.clone\(\)\.json\(\)/);
  assert.match(api, /typeof body\.error\.message === "string"/);
  assert.match(api, /client\.functions\.invoke\("staff-invite"/);
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE/);
});

test("staff workspace loads every live operational surface without demo records", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");

  for (const action of [
    "staff_context",
    "catalog_list",
    "enrollments_list",
    "waitlist_list",
    "private_requests_list",
    "analytics_summary",
    "staff_list",
    "staff_invites_list",
    "audit_list",
    "operations_status",
    "google_connection_status",
    "automation_jobs_list",
  ]) {
    assert.match(dashboard, new RegExp(`"${action}"`), action);
  }

  assert.doesNotMatch(dashboard, /analyticsSources|overviewMetrics|DemoButton|demo data/i);
  assert.doesNotMatch(dashboard, /@\/lib\/admin\/dashboard-data[^;]*\b(courses|bookings|waitlist)\b/);
});

test("staff mutations use the exact role-checked contracts", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");

  for (const action of [
    "course_upsert",
    "session_upsert",
    "private_request_update",
    "quote_create",
    "quote_send",
    "waitlist_offer",
    "waitlist_remove",
    "staff_update",
    "staff_invite_revoke",
    "course_price_update",
    "automation_job_cancel",
    "automation_job_rerun",
  ]) {
    assert.match(dashboard, new RegExp(`"${action}"`), action);
  }

  assert.match(dashboard, /window\.confirm\([\s\S]*personal checkout link/);
  assert.match(dashboard, /\{ quote_id: quote\.id \}/);
  assert.match(dashboard, /\{ entry_id: entry\.id \}/);
  assert.match(dashboard, /\{ invite_id: invite\.id \}/);
  assert.match(dashboard, /data\.role === "owner" \|\| data\.role === "admin"/);
  assert.match(dashboard, /data\.role === "owner"/);
});

test("signed-in owners and admins receive a verified public-site Admin menu link", async () => {
  const nav = await readFile(adminNavUrl, "utf8");

  assert.match(nav, /supabase\.auth\.getUser\(\)/u);
  assert.match(nav, /invokeAdmin<StaffContext>\(supabase, "staff_context"\)/u);
  assert.match(nav, /context\?\.role === "owner" \|\| context\?\.role === "admin"/u);
  assert.match(nav, /href="\/admin"/u);
  assert.doesNotMatch(nav, /user_metadata|service_role|SUPABASE_SERVICE/u);
});

test("course prices, schedule details, and queue controls use protected admin contracts", async () => {
  const [dashboard, adminFunction, migration] = await Promise.all([
    readFile(dashboardUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
    readFile(adminControlsMigrationUrl, "utf8"),
  ]);

  assert.match(dashboard, />Edit price<|>Edit price<\/button>/u);
  assert.match(dashboard, /"course_price_update"/u);
  assert.match(dashboard, /<SessionDialog/u);
  assert.match(dashboard, />Edit event<\/button>/u);
  assert.match(dashboard, /"automation_job_cancel"/u);
  assert.match(dashboard, /"automation_job_rerun"/u);
  assert.match(dashboard, /job\.job_type !== "email"/u);

  assert.match(adminFunction, /stripe\.prices\.create\(/u);
  assert.match(adminFunction, /tax_behavior: "inclusive"/u);
  assert.match(adminFunction, /idempotencyKey: `clearstep-course-price:/u);
  assert.match(adminFunction, /"update_course_price"/u);
  assert.match(adminFunction, /"cancel_automation_job"/u);
  assert.match(adminFunction, /"rerun_non_email_automation_job"/u);

  for (const functionName of [
    "get_course_pricing_for_update",
    "update_course_price",
    "cancel_automation_job",
    "rerun_non_email_automation_job",
  ]) {
    assert.match(migration, new RegExp(`function public\\.${functionName}`, "u"));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${functionName}`, "u"));
  }
  assert.match(migration, /status = 'pending'[\s\S]*pgmq\.archive/u);
  assert.match(migration, /status in \('failed', 'completed', 'cancelled'\)[\s\S]*job_type <> 'email'/u);
  assert.match(migration, /course\.price_updated/u);
});

test("course editing enforces the public catalog content bounds at every request", async () => {
  const [dashboard, adminFunction] = await Promise.all([
    readFile(dashboardUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
  ]);

  for (const maximum of [240, 120, 1000, 10000, 2000, 10019, 12419]) {
    assert.match(dashboard, new RegExp(`maxLength=\\{${maximum}\\}`, "u"), String(maximum));
  }
  assert.match(adminFunction, /validateCourseContent\(payload\)/u);
  assert.match(adminFunction, /payload\.outcomes\.length\s*>\s*20/u);
  assert.match(adminFunction, /payload\.agenda\.length\s*>\s*20/u);
  assert.match(adminFunction, /boundedText\(item\.detail,\s*500\)/u);
});

test("live analytics exposes the approved operational and acquisition metrics", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");

  for (const metric of [
    "private_requests",
    "waitlist_acceptances",
    "refund_count",
    "refunded_cents",
    "automation_failures",
    "upcoming_occupancy",
    "utm_sources",
  ]) {
    assert.match(dashboard, new RegExp(`analytics\\??\\.${metric}`, "u"), metric);
  }
  assert.match(dashboard, /course\.course_title/u);
  assert.match(dashboard, /UTM sources/u);
  assert.match(dashboard, /Upcoming occupancy/u);
});
