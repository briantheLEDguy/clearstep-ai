import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("one staff workspace manages both workshop and service commerce", async () => {
  const [sections, api, workspace, edge] = await Promise.all([
    read("components/admin/AdminSections.tsx"),
    read("lib/admin/admin-api.ts"),
    read("lib/admin/workspace.ts"),
    read("supabase/functions/admin-catalog/index.ts"),
  ]);

  for (const action of [
    "service_offerings_list",
    "service_offering_upsert",
    "service_offering_price_update",
    "service_orders_list",
    "service_order_fulfillment_update",
    "service_analytics_summary",
  ]) {
    assert.match(api, new RegExp(`\\| "${action}"`, "u"), action);
    assert.match(edge, new RegExp(`"${action}"`, "u"), action);
  }
  assert.match(workspace, /label: "Service catalog"/u);
  assert.match(workspace, /label: "Bookings & orders"/u);
  assert.match(sections, /Clearstep AI[\s\S]*Workshops & sessions/u);
  assert.match(sections, /Plate &amp; Post[\s\S]*Fixed service packages/u);
  assert.match(sections, /Manual scheduling/u);
  assert.match(sections, /serviceOrderStatusOptions/u);
  assert.match(sections, /Clearstep AI[\s\S]*Plate &amp; Post/u);
  assert.match(sections, /serviceAnalytics\.net_revenue_cents/u);
  assert.doesNotMatch(sections, /Plate &amp; Post[\s\S]{0,500}Add a workshop session/u);
});

test("service pricing reuses verified one-time inclusive Stripe prices", async () => {
  const [edge, priceValidation] = await Promise.all([
    read("supabase/functions/admin-catalog/index.ts"),
    read("supabase/functions/_shared/stripe.ts"),
  ]);

  assert.match(edge, /validateCatalogPrice/u);
  assert.match(edge, /tax_behavior: "inclusive"/u);
  assert.match(edge, /bnc_service_line: "plate_and_post"/u);
  assert.match(edge, /environment: stripeKey\.startsWith\("sk_test_"\)/u);
  assert.match(priceValidation, /price\.type !== "one_time"/u);
  assert.match(priceValidation, /price\.tax_behavior !== "inclusive"/u);
  assert.doesNotMatch(edge, /payment[_ -]?link/i);
});

test("shared legal documents and email wrapper cover both service lines", async () => {
  const [legalVersions, terms, cancellation, privacy, complaints, email] = await Promise.all([
    read("shared/legal-documents.ts"),
    read("app/terms/page.tsx"),
    read("app/cancellation/page.tsx"),
    read("app/privacy/page.tsx"),
    read("app/complaints/page.tsx"),
    read("supabase/functions/_shared/email.ts"),
  ]);

  assert.match(legalVersions, /version: "2026-08-19\.2"/u);
  for (const source of [terms, cancellation, privacy, complaints]) {
    assert.match(source, /BNC Consulting/u);
    assert.match(source, /Plate &(?:amp;| )Post/u);
  }
  assert.match(terms, /Clearstep AI workshops/u);
  assert.match(cancellation, /Payment does not reserve a particular shoot date/u);
  assert.match(email, />BNC Consulting</u);
  assert.match(email, /service_order_confirmation/u);
  assert.match(email, /service_order_admin_alert/u);
  assert.match(email, /"Plate & Post"/u);
});

test("human-reviewed customer requests can target a workshop or service order", async () => {
  const [edge, adminEdge, migration] = await Promise.all([
    read("supabase/functions/customer-requests/index.ts"),
    read("supabase/functions/admin-catalog/index.ts"),
    read("supabase/migrations/20260819161227_bnc_service_commerce.sql"),
  ]);

  assert.match(edge, /"create_purchase_request"/u);
  assert.match(edge, /p_service_order_id: serviceOrderId/u);
  assert.match(edge, /Number\(enrollmentId !== null\) \+ Number\(serviceOrderId !== null\) !== 1/u);
  assert.match(migration, /add column service_order_id uuid references public\.service_orders/u);
  assert.match(migration, /kind in \('cancellation', 'change'\)[\s\S]*num_nonnulls\(enrollment_id, service_order_id\) = 1/u);
  assert.match(migration, /customer_request_service_order_not_found/u);
  assert.match(migration, /create or replace function public\.list_customer_requests_page/u);
  assert.match(migration, /'service_order_id', visible\.service_order_id/u);
  assert.match(adminEdge, /page\.resource === "customer_requests"[\s\S]*"list_customer_requests_page"/u);
  assert.match(migration, /create or replace function public\.service_analytics_summary/u);
  assert.match(migration, /array\['owner', 'admin', 'analyst'\]/u);
});
