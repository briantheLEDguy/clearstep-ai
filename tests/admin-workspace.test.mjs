import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerUrl = new URL("../components/admin/AdminWorkspaceProvider.tsx", import.meta.url);
const shellUrl = new URL("../components/admin/AdminWorkspaceShell.tsx", import.meta.url);
const sectionsUrl = new URL("../components/admin/AdminSections.tsx", import.meta.url);
const routeUrl = new URL("../components/admin/AdminWorkspaceRoute.tsx", import.meta.url);
const sectionPageUrl = new URL("../app/admin/[section]/page.tsx", import.meta.url);
const workspaceUrl = new URL("../lib/admin/workspace.ts", import.meta.url);
const dialogsUrl = new URL("../components/admin/AdminDialogs.tsx", import.meta.url);
const timeUrl = new URL("../lib/admin/time.ts", import.meta.url);
const adminCssUrl = new URL("../app/admin/admin.module.css", import.meta.url);
const apiUrl = new URL("../lib/admin/admin-api.ts", import.meta.url);
const functionHelpersUrl = new URL("../lib/supabase/functions.ts", import.meta.url);
const adminFunctionUrl = new URL("../supabase/functions/admin-catalog/index.ts", import.meta.url);
const adminNavUrl = new URL("../components/admin/AdminNavLink.tsx", import.meta.url);
const adminControlsMigrationUrl = new URL("../supabase/migrations/20260818200414_admin_controls.sql", import.meta.url);
const dashboardOverviewMigrationUrl = new URL("../supabase/migrations/20260819122143_dashboard_overview_action.sql", import.meta.url);
const paginationMigrationUrl = new URL("../supabase/migrations/20260819123000_admin_cursor_pagination.sql", import.meta.url);

test("staff workspace uses a verified user and a server-side staff membership check", async () => {
  const provider = await readFile(providerUrl, "utf8");

  assert.match(provider, /client\.auth\.getUser\(\)/u);
  assert.match(provider, /invokeAdmin<StaffContext>\(client, "staff_context"\)/u);
  assert.match(provider, /staff_access_required/u);
  assert.match(provider, /<AdminWorkspaceContext\.Provider/u);
  assert.match(provider, /onAuthStateChange/u);
  assert.doesNotMatch(provider, /user_metadata|service_role|SUPABASE_SERVICE/u);
});

test("admin API unwraps Edge envelopes and reports server-provided errors", async () => {
  const [api, helpers] = await Promise.all([
    readFile(apiUrl, "utf8"),
    readFile(functionHelpersUrl, "utf8"),
  ]);

  assert.match(api, /client\.functions\.invoke\("admin-catalog"/u);
  assert.match(api, /body: \{ action, payload \}/u);
  assert.match(api, /functionErrorDetails/u);
  assert.match(api, /unwrapFunctionData/u);
  assert.match(helpers, /context\.clone\(\)\.json\(\)/u);
  assert.match(helpers, /FunctionApiError/u);
  assert.match(helpers, /typeof value\.error\.message === "string"/u);
  assert.match(api, /client\.functions\.invoke\("staff-invite"/u);
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE/u);
});

test("the workspace is route-sized, role-aware, and only loads the selected operation", async () => {
  const [route, sectionPage, workspace, provider] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(sectionPageUrl, "utf8"),
    readFile(workspaceUrl, "utf8"),
    readFile(providerUrl, "utf8"),
  ]);

  assert.match(route, /dynamic\(\(\) => import\("@\/components\/admin\/AdminSections"\)/u);
  assert.match(route, /canAccessAdminSection\(role, section\)/u);
  assert.match(sectionPage, /generateStaticParams/u);
  assert.match(sectionPage, /dynamicParams = false/u);
  assert.match(sectionPage, /adminSectionIds\.filter/u);
  assert.match(workspace, /minimumRole/u);
  assert.match(workspace, /id: "requests"/u);
  assert.match(provider, /cache\.current\.set\(key/u);
  assert.match(provider, /inFlight\.current\.get\(requestKey\)/u);
  assert.match(provider, /invalidate\(keys\)/u);
});

test("each admin surface uses protected live actions without demo records", async () => {
  const [sections, provider] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(providerUrl, "utf8"),
  ]);

  assert.match(provider, /"staff_context"/u);
  for (const action of [
    "catalog_list",
    "staff_list_page",
    "dashboard_overview",
    "analytics_summary",
    "staff_list",
    "staff_invites_list",
    "operations_status",
    "google_connection_status",
  ]) {
    assert.match(sections, new RegExp(`"${action}"`, "u"), action);
  }

  assert.doesNotMatch(sections, /analyticsSources|overviewMetrics|DemoButton|demo data/i);
  assert.doesNotMatch(sections, /@\/lib\/admin\/dashboard-data[^;]*\b(courses|bookings|waitlist)\b/u);
});

test("large staff detail views use typed cursor pages with a server-side role boundary", async () => {
  const [sections, adminFunction, migration] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
    readFile(paginationMigrationUrl, "utf8"),
  ]);

  assert.match(sections, /function useStaffPagedResource/u);
  assert.match(sections, /nextCursor/u);
  assert.match(sections, /<LoadMoreButton/u);
  for (const resource of ["enrollments", "waitlist", "private_requests", "customer_requests", "audit", "automation"]) {
    assert.match(sections, new RegExp(`"${resource}"`, "u"), resource);
    assert.match(migration, new RegExp(`when '${resource}'`, "u"), resource);
  }
  assert.match(adminFunction, /"staff_list_page"/u);
  assert.match(adminFunction, /"private_request_quotes_page"/u);
  assert.match(adminFunction, /function staffPagePayload/u);
  assert.match(adminFunction, /function privateRequestQuotesPagePayload/u);
  assert.match(adminFunction, /p_cursor_at: page\.cursorAt/u);
  assert.match(migration, /function public\.list_staff_page/u);
  assert.match(migration, /function public\.list_private_request_quotes_page/u);
  assert.match(migration, /\(p_cursor_at is null\) <> \(p_cursor_id is null\)/u);
  assert.match(migration, /p_limit < 1 or p_limit > 100/u);
  assert.match(migration, /private\.staff_members/u);
  assert.match(migration, /revoke execute on function public\.list_staff_page/u);
  assert.match(migration, /revoke execute on function public\.list_private_request_quotes_page/u);
  assert.match(migration, /private_quotes_request_page_idx/u);
  assert.match(migration, /order by q\.created_at desc, q\.id desc/u);
});

test("the dashboard overview is a protected aggregate-only action", async () => {
  const [sections, adminFunction, migration] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
    readFile(dashboardOverviewMigrationUrl, "utf8"),
  ]);

  assert.match(sections, /invokeAdmin<AnalyticsSummary>\(client, "dashboard_overview"\)/u);
  assert.match(sections, /useAdminResource\("overview", loader\)/u);
  assert.match(adminFunction, /"dashboard_overview"/u);
  assert.match(adminFunction, /"dashboard_overview", \{[\s\S]*p_actor_user_id: user\.id/u);
  assert.match(migration, /function public\.dashboard_overview/u);
  assert.match(migration, /private\.staff_has_role\(p_actor_user_id, array\['owner', 'admin', 'analyst'\]\)/u);
  assert.match(migration, /'analytics_summary'/u);
  assert.match(migration, /revoke execute on function public\.dashboard_overview/u);
});

test("staff mutations use protected contracts and an accessible confirmation dialog", async () => {
  const [sections, dialogs] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(dialogsUrl, "utf8"),
  ]);

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
    "customer_request_update",
  ]) {
    assert.match(sections, new RegExp(`"${action}"`, "u"), action);
  }

  assert.match(sections, /<ConfirmDialog/u);
  assert.doesNotMatch(sections, /window\.confirm/u);
  assert.match(sections, /\{ quote_id: quote\.id \}/u);
  assert.match(sections, /\{ entry_id: entry\.id \}/u);
  assert.match(sections, /\{ invite_id: invite\.id \}/u);
  assert.match(dialogs, /dialog\.showModal\(\)/u);
  assert.match(dialogs, /returnFocusRef\.current\?\.focus\(\)/u);
  assert.match(dialogs, /onCancel/u);
  assert.match(dialogs, /initialFocusRef=\{cancelRef\}/u);
});

test("the staff shell provides landmarks, role-filtered navigation, focus targets, and table labels", async () => {
  const [shell, sections, css] = await Promise.all([
    readFile(shellUrl, "utf8"),
    readFile(sectionsUrl, "utf8"),
    readFile(adminCssUrl, "utf8"),
  ]);

  assert.match(shell, /href="#admin-main"/u);
  assert.match(shell, /aria-label="Staff workspace navigation"/u);
  assert.match(shell, /aria-current=\{section === item\.id \? "page"/u);
  assert.match(shell, /id="admin-main"/u);
  assert.match(shell, /aria-busy=\{busy !== null\}/u);
  assert.match(sections, /<th scope="col">/u);
  assert.match(sections, /role="region"/u);
  assert.match(css, /\.skipLink/u);
  assert.match(css, /\.sessionDialog::backdrop/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /--admin-action: #087547/u);
});

test("Amsterdam schedule entry rejects daylight-saving gaps and repeated times", async () => {
  const [sections, time] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(timeUrl, "utf8"),
  ]);

  assert.match(sections, /amsterdamLocalToIso/u);
  assert.match(sections, /assertEndAfterStart/u);
  assert.match(time, /matches\.length === 0/u);
  assert.match(time, /matches\.length > 1/u);
  assert.match(time, /does not exist because clocks change/u);
  assert.match(time, /occurs twice because clocks change/u);
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
  const [sections, adminFunction, migration] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
    readFile(adminControlsMigrationUrl, "utf8"),
  ]);

  assert.match(sections, /Edit price for/u);
  assert.match(sections, /"course_price_update"/u);
  assert.match(sections, /<SessionDialog/u);
  assert.match(sections, />Edit event<\/button>/u);
  assert.match(sections, /"automation_job_cancel"/u);
  assert.match(sections, /"automation_job_rerun"/u);
  assert.match(sections, /job\.job_type !== "email"/u);

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
  const [sections, adminFunction] = await Promise.all([
    readFile(sectionsUrl, "utf8"),
    readFile(adminFunctionUrl, "utf8"),
  ]);

  for (const maximum of [240, 120, 1000, 10000, 2000, 10019, 12419]) {
    assert.match(sections, new RegExp(`maxLength=\\{${maximum}\\}`, "u"), String(maximum));
  }
  assert.match(adminFunction, /validateCourseContent\(payload\)/u);
  assert.match(adminFunction, /payload\.outcomes\.length\s*>\s*20/u);
  assert.match(adminFunction, /payload\.agenda\.length\s*>\s*20/u);
  assert.match(adminFunction, /boundedText\(item\.detail,\s*500\)/u);
});

test("live analytics exposes the approved operational and acquisition metrics", async () => {
  const sections = await readFile(sectionsUrl, "utf8");

  for (const metric of [
    "private_requests",
    "waitlist_acceptances",
    "refund_count",
    "refunded_cents",
    "automation_failures",
    "upcoming_occupancy",
    "utm_sources",
  ]) {
    assert.match(sections, new RegExp(`analytics\\??\\.${metric}`, "u"), metric);
  }
  assert.match(sections, /course\.course_title/u);
  assert.match(sections, /UTM sources/u);
  assert.match(sections, /Upcoming occupancy/u);
});
