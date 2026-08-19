"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { AccessibleDialog, ConfirmDialog } from "@/components/admin/AdminDialogs";
import { useAdminResource, useAdminWorkspace, type AdminResourceKey } from "@/components/admin/AdminWorkspaceProvider";
import { invokeAdmin, type AdminAction } from "@/lib/admin/admin-api";
import {
  dateOnly,
  dateTime,
  money,
  recordArray,
  statusFor,
  type AdminStatus,
  type AdminTone,
  type AnalyticsSummary,
  type AuditRecord,
  type AutomationJobRecord,
  type CourseRecord,
  type EnrollmentRecord,
  type GoogleConnectionRecord,
  type IntegrationRecord,
  type PrivateRequestRecord,
  type QuoteRecord,
  type ServiceOfferingRecord,
  type ServiceAnalyticsSummary,
  type ServiceOrderRecord,
  type SessionRecord,
  type StaffInvitationRecord,
  type StaffMemberRecord,
  type StaffRole,
  type WaitlistRecord,
} from "@/lib/admin/dashboard-data";
import { LocalDateTimeError, amsterdamLocalToIso, assertEndAfterStart, toAmsterdamLocalInput } from "@/lib/admin/time";

import styles from "@/app/admin/admin.module.css";

type SessionWithCourse = SessionRecord & { courseTitle: string };
type Mutate = (input: {
  operation: string;
  action: AdminAction;
  payload: Record<string, unknown>;
  success: string;
  invalidate: AdminResourceKey[];
}) => Promise<boolean>;
type PendingAction = {
  operation: string;
  action: AdminAction;
  payload: Record<string, unknown>;
  title: string;
  description: string;
  confirmLabel: string;
  success: string;
  invalidate: AdminResourceKey[];
  danger?: boolean;
};

type CustomerRequest = {
  id: string;
  kind: "access" | "correction" | "erasure" | "restriction" | "objection" | "cancellation" | "change";
  status: "submitted" | "in_review" | "awaiting_customer" | "completed" | "declined";
  enrollment_id: string | null;
  service_order_id: string | null;
  details: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

const sectionHeadingIds: Record<string, string> = {
  "Workshop operations": "overview-title",
  Analytics: "analytics-title",
  "Service catalog": "catalog-title",
  "Bookings & orders": "bookings-title",
  Waitlist: "waitlist-title",
  "Requests & quotes": "private-title",
  "Customer requests": "customer-requests-title",
  "Team & invitations": "team-title",
  "Audit log": "audit-title",
  Integrations: "integrations-title",
  "Automation queue": "automation-title",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayFrom<T>(value: unknown, ...keys: string[]): T[] {
  for (const key of keys) {
    const records = recordArray<T>(value, key);
    if (records.length || (isRecord(value) && Array.isArray(value[key]))) return records;
  }
  return [];
}

type StaffPageResource = "enrollments" | "waitlist" | "private_requests" | "customer_requests" | "audit" | "automation";
type StaffPageCursor = { at: string; id: string };
type StaffPage<T> = { items: T[]; nextCursor: StaffPageCursor | null };
type LoadedStaffPage<T> = StaffPage<T> & { source: StaffPage<T> | null; error: string | null };
type StaffPageRecordMap = {
  enrollments: EnrollmentRecord;
  waitlist: WaitlistRecord;
  private_requests: PrivateRequestRecord;
  customer_requests: CustomerRequest;
  audit: AuditRecord;
  automation: AutomationJobRecord;
};

const pageUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidStaffPage(resource: StaffPageResource, field: string): never {
  throw new Error(`The ${resource.replaceAll("_", " ")} response is missing a valid ${field}.`);
}

function pageObject(value: unknown, resource: StaffPageResource): Record<string, unknown> {
  if (!isRecord(value)) invalidStaffPage(resource, "record");
  return value;
}

function pageString(record: Record<string, unknown>, field: string, resource: StaffPageResource) {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) invalidStaffPage(resource, field);
  return value;
}

function pageNullableString(record: Record<string, unknown>, field: string, resource: StaffPageResource) {
  const value = record[field];
  if (value === null) return null;
  return pageString(record, field, resource);
}

function pageNumber(record: Record<string, unknown>, field: string, resource: StaffPageResource) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) invalidStaffPage(resource, field);
  return value;
}

function pageNullableNumber(record: Record<string, unknown>, field: string, resource: StaffPageResource) {
  const value = record[field];
  if (value === null) return null;
  return pageNumber(record, field, resource);
}

function pageBoolean(record: Record<string, unknown>, field: string, resource: StaffPageResource) {
  const value = record[field];
  if (typeof value !== "boolean") invalidStaffPage(resource, field);
  return value;
}

function pageEnum<T extends string>(record: Record<string, unknown>, field: string, resource: StaffPageResource, values: readonly T[]): T {
  const value = pageString(record, field, resource);
  if (!(values as readonly string[]).includes(value)) invalidStaffPage(resource, field);
  return value as T;
}

function parseQuote(value: unknown): QuoteRecord {
  const record = pageObject(value, "private_requests");
  return {
    id: pageString(record, "id", "private_requests"),
    request_id: pageString(record, "request_id", "private_requests"),
    amount_cents: pageNumber(record, "amount_cents", "private_requests"),
    currency: pageString(record, "currency", "private_requests"),
    vat_inclusive: pageBoolean(record, "vat_inclusive", "private_requests"),
    description: pageString(record, "description", "private_requests"),
    valid_until: pageString(record, "valid_until", "private_requests"),
    status: pageString(record, "status", "private_requests"),
    sent_at: pageNullableString(record, "sent_at", "private_requests"),
    accepted_at: pageNullableString(record, "accepted_at", "private_requests"),
    created_at: pageString(record, "created_at", "private_requests"),
  };
}

function parseEnrollment(value: unknown): EnrollmentRecord {
  const record = pageObject(value, "enrollments");
  return {
    id: pageString(record, "id", "enrollments"),
    session_id: pageString(record, "session_id", "enrollments"),
    attendee_email: pageString(record, "attendee_email", "enrollments"),
    attendee_name: pageNullableString(record, "attendee_name", "enrollments"),
    status: pageString(record, "status", "enrollments"),
    amount_cents: pageNumber(record, "amount_cents", "enrollments"),
    currency: pageString(record, "currency", "enrollments"),
    booked_at: pageString(record, "booked_at", "enrollments"),
    confirmed_at: pageNullableString(record, "confirmed_at", "enrollments"),
    course_title: pageString(record, "course_title", "enrollments"),
    start_at: pageString(record, "start_at", "enrollments"),
    timezone: pageString(record, "timezone", "enrollments"),
  };
}

function parseWaitlist(value: unknown): WaitlistRecord {
  const record = pageObject(value, "waitlist");
  const position = pageNullableNumber(record, "position", "waitlist");
  return {
    id: pageString(record, "id", "waitlist"),
    session_id: pageString(record, "session_id", "waitlist"),
    email: pageString(record, "email", "waitlist"),
    full_name: pageNullableString(record, "full_name", "waitlist"),
    status: pageString(record, "status", "waitlist"),
    joined_at: pageString(record, "joined_at", "waitlist"),
    offered_at: pageNullableString(record, "offered_at", "waitlist"),
    offer_expires_at: pageNullableString(record, "offer_expires_at", "waitlist"),
    accepted_at: pageNullableString(record, "accepted_at", "waitlist"),
    ...(position === null ? {} : { position }),
    course_slug: pageString(record, "course_slug", "waitlist"),
    course_title: pageString(record, "course_title", "waitlist"),
    session_start_at: pageString(record, "session_start_at", "waitlist"),
    session_timezone: pageString(record, "session_timezone", "waitlist"),
  };
}

function parsePrivateRequest(value: unknown): PrivateRequestRecord {
  const record = pageObject(value, "private_requests");
  const rawQuotes = record.quotes;
  if (!Array.isArray(rawQuotes)) invalidStaffPage("private_requests", "quotes");
  const quoteCount = pageNumber(record, "quote_count", "private_requests");
  return {
    id: pageString(record, "id", "private_requests"),
    contact_name: pageString(record, "contact_name", "private_requests"),
    email: pageString(record, "email", "private_requests"),
    organization: pageString(record, "organization", "private_requests"),
    attendee_count: pageNullableNumber(record, "attendee_count", "private_requests"),
    preferred_format: pageNullableString(record, "preferred_format", "private_requests"),
    preferred_timing: pageNullableString(record, "preferred_timing", "private_requests"),
    goals: pageString(record, "goals", "private_requests"),
    status: pageString(record, "status", "private_requests"),
    created_at: pageString(record, "created_at", "private_requests"),
    updated_at: pageString(record, "updated_at", "private_requests"),
    quotes: rawQuotes.map(parseQuote),
    quote_count: quoteCount,
    quotes_truncated: pageBoolean(record, "quotes_truncated", "private_requests"),
  };
}

function parseCustomerRequest(value: unknown): CustomerRequest {
  const record = pageObject(value, "customer_requests");
  return {
    id: pageString(record, "id", "customer_requests"),
    kind: pageEnum(record, "kind", "customer_requests", ["access", "correction", "erasure", "restriction", "objection", "cancellation", "change"]),
    status: pageEnum(record, "status", "customer_requests", ["submitted", "in_review", "awaiting_customer", "completed", "declined"]),
    enrollment_id: pageNullableString(record, "enrollment_id", "customer_requests"),
    service_order_id: pageNullableString(record, "service_order_id", "customer_requests"),
    details: pageNullableString(record, "details", "customer_requests"),
    created_at: pageString(record, "created_at", "customer_requests"),
    updated_at: pageString(record, "updated_at", "customer_requests"),
    resolved_at: pageNullableString(record, "resolved_at", "customer_requests"),
    resolution_note: pageNullableString(record, "resolution_note", "customer_requests"),
  };
}

function parseAudit(value: unknown): AuditRecord {
  const record = pageObject(value, "audit");
  const id = pageString(record, "id", "audit");
  if (!/^\d+$/u.test(id)) invalidStaffPage("audit", "id");
  return {
    id,
    actor_user_id: pageNullableString(record, "actor_user_id", "audit"),
    action: pageString(record, "action", "audit"),
    target_type: pageString(record, "target_type", "audit"),
    target_id: pageNullableString(record, "target_id", "audit"),
    occurred_at: pageString(record, "occurred_at", "audit"),
  };
}

function parseAutomation(value: unknown): AutomationJobRecord {
  const record = pageObject(value, "automation");
  return {
    id: pageString(record, "id", "automation"),
    job_type: pageString(record, "job_type", "automation"),
    status: pageString(record, "status", "automation"),
    attempts: pageNumber(record, "attempts", "automation"),
    max_attempts: pageNumber(record, "max_attempts", "automation"),
    available_at: pageString(record, "available_at", "automation"),
    last_error: pageNullableString(record, "last_error", "automation"),
    created_at: pageString(record, "created_at", "automation"),
    completed_at: pageNullableString(record, "completed_at", "automation"),
    email_delivery_status: pageNullableString(record, "email_delivery_status", "automation"),
    requires_reconciliation: pageBoolean(record, "requires_reconciliation", "automation"),
  };
}

const staffPageParsers = {
  enrollments: parseEnrollment,
  waitlist: parseWaitlist,
  private_requests: parsePrivateRequest,
  customer_requests: parseCustomerRequest,
  audit: parseAudit,
  automation: parseAutomation,
} satisfies { [Resource in StaffPageResource]: (value: unknown) => StaffPageRecordMap[Resource] };

function parseStaffPage<Resource extends StaffPageResource>(resource: Resource, value: unknown): StaffPage<StaffPageRecordMap[Resource]> {
  const response = pageObject(value, resource);
  if (!Array.isArray(response.items)) invalidStaffPage(resource, "items");
  const rawCursor = response.next_cursor;
  let nextCursor: StaffPageCursor | null = null;
  if (rawCursor !== null) {
    const cursor = pageObject(rawCursor, resource);
    const at = pageString(cursor, "at", resource);
    const id = pageString(cursor, "id", resource);
    if (resource === "audit" ? !/^\d+$/u.test(id) : !pageUuidPattern.test(id)) {
      invalidStaffPage(resource, "cursor id");
    }
    nextCursor = { at, id };
  }
  const parser = staffPageParsers[resource] as (item: unknown) => StaffPageRecordMap[Resource];
  return { items: response.items.map(parser), nextCursor };
}

function parseQuotePage(value: unknown): StaffPage<QuoteRecord> {
  const response = pageObject(value, "private_requests");
  if (!Array.isArray(response.items)) invalidStaffPage("private_requests", "quote items");
  const rawCursor = response.next_cursor;
  let nextCursor: StaffPageCursor | null = null;
  if (rawCursor !== null) {
    const cursor = pageObject(rawCursor, "private_requests");
    const at = pageString(cursor, "at", "private_requests");
    const id = pageString(cursor, "id", "private_requests");
    if (!pageUuidPattern.test(id)) invalidStaffPage("private_requests", "quote cursor id");
    nextCursor = { at, id };
  }
  return { items: response.items.map(parseQuote), nextCursor };
}

function useStaffPagedResource<Resource extends StaffPageResource>(key: AdminResourceKey, resource: Resource) {
  const { client } = useAdminWorkspace();
  const fetchPage = useCallback(async (cursor: StaffPageCursor | null) => {
    const payload: Record<string, unknown> = { resource, limit: 50 };
    if (cursor) payload.cursor = cursor;
    return parseStaffPage(resource, await invokeAdmin<unknown>(client, "staff_list_page", payload));
  }, [client, resource]);
  const loader = useCallback(() => fetchPage(null), [fetchPage]);
  const base = useAdminResource<StaffPage<StaffPageRecordMap[Resource]>>(key, loader);
  const [loaded, setLoaded] = useState<LoadedStaffPage<StaffPageRecordMap[Resource]>>({ source: null, items: [], nextCursor: null, error: null });
  const current = useMemo<LoadedStaffPage<StaffPageRecordMap[Resource]>>(() => (
    loaded.source === base.data
      ? loaded
      : { source: base.data, items: base.data?.items ?? [], nextCursor: base.data?.nextCursor ?? null, error: null }
  ), [base.data, loaded]);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    const cursor = current.nextCursor;
    const source = base.data;
    if (!cursor || !source || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchPage(cursor);
      if (base.data === source) {
        setLoaded({ source, items: [...current.items, ...next.items], nextCursor: next.nextCursor, error: null });
      }
    } catch (error) {
      if (base.data === source) {
        setLoaded({ ...current, error: error instanceof Error ? error.message : "The next page could not be loaded." });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [base.data, current, fetchPage, loadingMore]);

  return {
    items: current.items,
    error: base.error ?? current.error,
    loading: base.loading,
    reload: base.reload,
    hasMore: Boolean(current.nextCursor),
    loadingMore,
    loadMore,
  };
}

function LoadMoreButton({ hasMore, loading, onClick, label }: { hasMore: boolean; loading: boolean; onClick: () => void; label: string }) {
  return hasMore ? <div className={styles.tableActions}><button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void onClick()}>{loading ? "Loading…" : label}</button></div> : null;
}

function errorFromForm(error: unknown) {
  return error instanceof LocalDateTimeError ? error.message : "Check the information above and try again.";
}

function coursePayload(course: CourseRecord, status: string, stripeIds?: { productId: string; priceId: string }) {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    description: course.description,
    outcomes: course.outcomes,
    level: course.level,
    audience: course.audience,
    agenda: course.agenda,
    duration_minutes: course.duration_minutes,
    price_cents: course.price_cents,
    stripe_product_id: stripeIds?.productId ?? course.stripe_product_id ?? "",
    stripe_price_id: stripeIds?.priceId ?? course.stripe_price_id ?? "",
    status,
    seo_title: course.seo_title ?? "",
    seo_description: course.seo_description ?? "",
  };
}

function serviceOfferingPayload(
  service: ServiceOfferingRecord,
  status = service.status,
  stripeIds?: { productId: string; priceId: string },
) {
  return {
    catalog_item_id: service.catalog_item_id,
    slug: service.slug,
    title: service.title,
    summary: service.summary,
    description: service.description,
    outcomes: service.outcomes,
    audience: service.audience,
    duration_minutes: service.duration_minutes,
    fulfillment_method: "manual_scheduling",
    price_cents: service.price_cents,
    currency: "EUR",
    stripe_product_id: stripeIds?.productId ?? service.stripe_product_id ?? "",
    stripe_price_id: stripeIds?.priceId ?? service.stripe_price_id ?? "",
    visibility: service.visibility,
    status,
    seo_title: service.seo_title ?? "",
    seo_description: service.seo_description ?? "",
  };
}

function serviceOfferingStatus(value: string): ServiceOfferingRecord["status"] {
  if (value === "draft" || value === "published" || value === "archived") return value;
  throw new Error("Choose a valid service package status.");
}

function sessionPayload(session: SessionRecord, status: string) {
  return {
    id: session.id,
    course_id: session.course_id,
    format: session.format,
    start_at: session.start_at,
    end_at: session.end_at,
    timezone: session.timezone,
    venue: session.venue ?? "",
    capacity: session.capacity,
    status,
  };
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 className={styles.sectionTitle} id={sectionHeadingIds[title]}>{title}</h2>
        <p className={styles.sectionDescription}>{description}</p>
      </div>
      {action ? <div className={styles.sectionAction}>{action}</div> : null}
    </div>
  );
}

function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return <button className={styles.refreshButton} type="button" disabled={loading} onClick={onClick}>{loading ? "Refreshing…" : "Refresh"}</button>;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.panel} ${className}`}>{children}</div>;
}

function PanelHeader({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <div className={styles.panelHeader}><div><p className={styles.panelKicker}>{kicker}</p><h3>{title}</h3></div>{action}</div>;
}

function StatusBadge({ status }: { status: AdminStatus }) {
  return <span className={`${styles.status} ${styles[`tone${capitalize(status.tone)}`]}`}><span className={styles.statusDot} aria-hidden="true" />{status.label}</span>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: AdminTone }) {
  return <Panel className={styles.metricCard}><div className={styles.metricLabel}><span className={`${styles.metricMarker} ${styles[`tone${capitalize(tone)}`]}`} aria-hidden="true" />{label}</div><strong className={styles.metricValue}>{value}</strong><span className={styles.metricChange}>{detail}</span></Panel>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className={styles.emptyState}><span className={styles.emptyMark} aria-hidden="true">✓</span><div><strong>{title}</strong><p>{description}</p></div></div>;
}

function SectionError({ message }: { message: string | null | undefined }) {
  return message ? <div className={styles.sectionError} role="alert"><strong>Information unavailable</strong><span>{message}</span></div> : null;
}

function FormError({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  return message ? <div className={styles.formError} role="alert" tabIndex={-1} ref={ref}>{message}</div> : null;
}

function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.tableWrap} role="region" aria-label={`${label}. Scroll horizontally to view all columns.`}>{children}</div>;
}

function PendingActionDialog({ action, onDismiss }: { action: PendingAction | null; onDismiss: () => void }) {
  const { busy, mutate } = useAdminWorkspace();
  if (!action) return null;
  return (
    <ConfirmDialog
      title={action.title}
      description={action.description}
      confirmLabel={action.confirmLabel}
      danger={action.danger}
      busy={busy === action.operation}
      onCancel={onDismiss}
      onConfirm={() => void (async () => {
        const complete = await mutate(action);
        if (complete) onDismiss();
      })()}
    />
  );
}

type AnalyticsServiceLine = "clearstep" | "plate_and_post";
type AnalyticsResult =
  | { serviceLine: "clearstep"; summary: AnalyticsSummary }
  | { serviceLine: "plate_and_post"; summary: ServiceAnalyticsSummary };

function useAnalytics(serviceLine: AnalyticsServiceLine) {
  const { client } = useAdminWorkspace();
  const loader = useCallback(async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const range = { from: from.toISOString(), to: now.toISOString() };
    if (serviceLine === "plate_and_post") {
      const summary = await invokeAdmin<ServiceAnalyticsSummary>(client, "service_analytics_summary", range);
      return { serviceLine, summary } satisfies AnalyticsResult;
    }
    const summary = await invokeAdmin<AnalyticsSummary>(client, "analytics_summary", range);
    return { serviceLine, summary } satisfies AnalyticsResult;
  }, [client, serviceLine]);
  return useAdminResource<AnalyticsResult>(serviceLine === "clearstep" ? "analytics" : "serviceAnalytics", loader);
}

function useOverview() {
  const { client } = useAdminWorkspace();
  const loader = useCallback(
    async () => invokeAdmin<AnalyticsSummary>(client, "dashboard_overview"),
    [client],
  );
  return useAdminResource("overview", loader);
}

export function OverviewSection() {
  const { role } = useAdminWorkspace();
  const { data: analytics, error, loading, reload } = useOverview();
  const occupancy = analytics?.upcoming_occupancy ?? [];
  return (
    <section className={styles.section} aria-labelledby="overview-title">
      <SectionHeader
        eyebrow={analytics ? `Updated ${dateTime(analytics.to)}` : "Live workspace"}
        title="Workshop operations"
        description={role === "analyst" ? "Your analytics access is read-only." : "Start with current workshop performance, then open the relevant operation."}
        action={<RefreshButton onClick={reload} loading={loading} />}
      />
      <SectionError message={error} />
      <div className={styles.metricGrid} aria-busy={loading}>
        <Metric label="Confirmed (30 days)" value={String(analytics?.confirmed_enrollments ?? 0)} detail="Paid enrolments" tone="success" />
        <Metric label="Upcoming sessions" value={String(occupancy.length)} detail="Scheduled dates" tone="info" />
        <Metric label="Waitlist joins (30 days)" value={String(analytics?.waitlist_joins ?? 0)} detail="New FIFO entries" tone="warning" />
        <Metric label="Revenue (30 days)" value={money(analytics?.revenue_cents ?? 0, analytics?.currency)} detail="VAT-inclusive paid value" tone="neutral" />
      </div>
      <div className={styles.overviewGrid}>
        <Panel>
          <PanelHeader kicker="Schedule" title="Upcoming occupancy" />
          {occupancy.length ? <ol className={styles.scheduleList}>{occupancy.slice(0, 4).map((session) => {
            const occupied = session.confirmed + session.active_holds;
            return <li className={styles.scheduleItem} key={session.session_id}><time dateTime={session.start_at} className={styles.dateTile}><strong>{new Date(session.start_at).toLocaleDateString("en-NL", { day: "numeric", timeZone: "Europe/Amsterdam" })}</strong><span>{new Date(session.start_at).toLocaleDateString("en-NL", { month: "short", timeZone: "Europe/Amsterdam" })}</span></time><div className={styles.scheduleCopy}><strong>{session.course_title}</strong><span>{occupied} of {session.capacity} places · {dateTime(session.start_at)}</span></div></li>;
          })}</ol> : <EmptyState title="No upcoming sessions" description="Create a draft session when the next date is ready." />}
        </Panel>
        <Panel>
          <PanelHeader kicker="Quick routes" title="Open an operation" />
          <div className={styles.attentionList}>
            {role !== "analyst" ? <Link className={styles.attentionItem} href="/admin/catalog"><span className={`${styles.attentionMarker} ${styles.toneInfo}`} aria-hidden="true" /><span><strong>Service catalog</strong><small>Manage workshops, sessions, and service packages</small></span><span className={styles.arrow} aria-hidden="true">→</span></Link> : null}
            <Link className={styles.attentionItem} href="/admin/analytics"><span className={`${styles.attentionMarker} ${styles.toneSuccess}`} aria-hidden="true" /><span><strong>Analytics</strong><small>Review first-party activity and results</small></span><span className={styles.arrow} aria-hidden="true">→</span></Link>
            {role === "owner" ? <Link className={styles.attentionItem} href="/admin/automation"><span className={`${styles.attentionMarker} ${analytics?.automation_failures ? styles.toneDanger : styles.toneSuccess}`} aria-hidden="true" /><span><strong>Automation</strong><small>{analytics?.automation_failures ?? 0} terminal jobs in this period</small></span><span className={styles.arrow} aria-hidden="true">→</span></Link> : null}
          </div>
        </Panel>
      </div>
    </section>
  );
}

export function AnalyticsSection() {
  const [serviceLine, setServiceLine] = useState<AnalyticsServiceLine>("clearstep");
  const { data, error, loading, reload } = useAnalytics(serviceLine);
  const analytics = data?.serviceLine === "clearstep" ? data.summary : null;
  const serviceAnalytics = data?.serviceLine === "plate_and_post" ? data.summary : null;
  const funnel = [
    { label: "Page views", value: analytics?.page_views ?? 0 },
    { label: "Workshop views", value: analytics?.course_views ?? 0 },
    { label: "Checkout starts", value: analytics?.checkout_starts ?? 0 },
    { label: "Paid bookings", value: analytics?.confirmed_enrollments ?? 0 },
  ];
  const max = Math.max(1, ...funnel.map((step) => step.value));
  return (
    <section className={styles.section} aria-labelledby="analytics-title">
      <SectionHeader eyebrow="Last 30 days" title="Analytics" description="First-party, privacy-friendly activity and verified purchase results." action={<RefreshButton onClick={reload} loading={loading} />} />
      <div className={styles.analyticsFilter}>
        <label htmlFor="analytics-service-line">Service line</label>
        <select
          id="analytics-service-line"
          value={serviceLine}
          onChange={(event) => setServiceLine(event.target.value as AnalyticsServiceLine)}
        >
          <option value="clearstep">Clearstep AI</option>
          <option value="plate_and_post">Plate &amp; Post</option>
        </select>
      </div>
      <SectionError message={error} />
      {serviceLine === "clearstep" && analytics ? <>
        <div className={styles.analyticsMetrics} aria-busy={loading}>
          <Panel><span>Page views</span><strong>{analytics.page_views}</strong><small>First-party events</small></Panel>
          <Panel><span>Workshop views</span><strong>{analytics.course_views}</strong><small>{percent(analytics.course_views, analytics.page_views)} of page views</small></Panel>
          <Panel><span>Checkout starts</span><strong>{analytics.checkout_starts}</strong><small>{percent(analytics.checkout_starts, analytics.course_views)} of workshop views</small></Panel>
          <Panel><span>Paid bookings</span><strong>{analytics.confirmed_enrollments}</strong><small>{money(analytics.net_revenue_cents, analytics.currency)} net revenue</small></Panel>
          <Panel><span>Private requests</span><strong>{analytics.private_requests}</strong><small>New enquiries</small></Panel>
          <Panel><span>Waitlist conversion</span><strong>{percent(analytics.waitlist_acceptances, analytics.waitlist_joins)}</strong><small>{analytics.waitlist_acceptances} accepted from {analytics.waitlist_joins} joins</small></Panel>
          <Panel><span>Refunds</span><strong>{analytics.refund_count}</strong><small>{money(analytics.refunded_cents, analytics.currency)} refunded</small></Panel>
          <Panel><span>Automation failures</span><strong>{analytics.automation_failures}</strong><small>Terminal jobs in this period</small></Panel>
        </div>
        <div className={styles.analyticsGrid}>
          <Panel><PanelHeader kicker="Booking funnel" title="From visit to enrolment" /><ol className={styles.funnel}>{funnel.map((step) => <li key={step.label} style={{ width: `${Math.max(28, Math.round((step.value / max) * 100))}%` }}><span>{step.label}</span><strong>{step.value}</strong></li>)}</ol></Panel>
          <MetricList kicker="Interest" title="Most-viewed courses" entries={analytics.top_courses.map((course) => ({ label: course.course_title || "Unattributed", detail: `${course.views} views`, value: course.views }))} emptyTitle="No workshop views yet" emptyDescription="Course-view events will appear here after visitors browse workshops." />
          <MetricList kicker="Capacity" title="Upcoming occupancy" entries={analytics.upcoming_occupancy.map((session) => ({ label: session.course_title, detail: `${session.confirmed + session.active_holds} of ${session.capacity} places · ${dateTime(session.start_at)}`, value: session.confirmed + session.active_holds, maximum: session.capacity }))} emptyTitle="No upcoming sessions" emptyDescription="Occupancy appears after a session is scheduled." />
          <MetricList kicker="Acquisition" title="UTM sources" entries={analytics.utm_sources.map((source) => ({ label: source.source, detail: `${source.visits} visits`, value: source.visits }))} emptyTitle="No campaign sources yet" emptyDescription="UTM-tagged visits will appear here without third-party cookies." />
        </div>
      </> : null}
      {serviceLine === "plate_and_post" && serviceAnalytics ? (
        <div className={styles.analyticsMetrics} aria-busy={loading}>
          <Panel><span>Orders started</span><strong>{serviceAnalytics.orders_started}</strong><small>Checkout sessions created</small></Panel>
          <Panel><span>Paid orders</span><strong>{serviceAnalytics.paid_orders}</strong><small>Verified Stripe payments</small></Panel>
          <Panel><span>Pending payments</span><strong>{serviceAnalytics.pending_orders}</strong><small>Not yet payment-terminal</small></Panel>
          <Panel><span>Refunded orders</span><strong>{serviceAnalytics.refunded_orders}</strong><small>{money(serviceAnalytics.refunded_cents, serviceAnalytics.currency)} refunded</small></Panel>
          <Panel><span>Gross revenue</span><strong>{money(serviceAnalytics.gross_revenue_cents, serviceAnalytics.currency)}</strong><small>Paid value before refunds</small></Panel>
          <Panel><span>Net revenue</span><strong>{money(serviceAnalytics.net_revenue_cents, serviceAnalytics.currency)}</strong><small>Gross less recorded refunds</small></Panel>
        </div>
      ) : null}
      {!data && !error ? <EmptyState title="Loading analytics" description="The protected analytics summary is loading." /> : null}
    </section>
  );
}

function MetricList({ kicker, title, entries, emptyTitle, emptyDescription }: { kicker: string; title: string; entries: Array<{ label: string; detail: string; value: number; maximum?: number }>; emptyTitle: string; emptyDescription: string }) {
  const max = Math.max(1, ...entries.map((entry) => entry.maximum ?? entry.value));
  return <Panel><PanelHeader kicker={kicker} title={title} />{entries.length ? <ul className={styles.sourceList}>{entries.map((entry) => <li className={styles.sourceRow} key={`${entry.label}-${entry.detail}`}><div><strong>{entry.label}</strong><span>{entry.detail}</span></div><meter className={styles.sourceBar} min={0} max={entry.maximum ?? max} value={entry.value} aria-label={`${entry.label}: ${entry.detail}`} /></li>)}</ul> : <EmptyState title={emptyTitle} description={emptyDescription} />}</Panel>;
}

export function CatalogSection() {
  const { client, busy, mutate } = useAdminWorkspace();
  const loader = useCallback(async () => {
    const [courseResponse, serviceResponse] = await Promise.all([
      invokeAdmin<unknown>(client, "catalog_list"),
      invokeAdmin<unknown>(client, "service_offerings_list"),
    ]);
    return {
      courses: arrayFrom<CourseRecord>(courseResponse, "courses"),
      services: arrayFrom<ServiceOfferingRecord>(serviceResponse, "services"),
    };
  }, [client]);
  const { data: catalogData, error, loading, reload } = useAdminResource("catalog", loader);
  const courses = catalogData?.courses ?? [];
  const services = catalogData?.services ?? [];
  const [selectedSession, setSelectedSession] = useState<SessionWithCourse | null>(null);
  const sessions = courses.flatMap((course) => course.sessions.map((session) => ({ ...session, courseTitle: course.title })));
  const doMutate: Mutate = mutate;
  return (
    <section className={styles.section} aria-labelledby="catalog-title">
      <SectionHeader eyebrow="BNC services" title="Service catalog" description="Manage Clearstep workshops and Plate & Post packages from one protected catalog. Publishing a workshop session queues its calendar setup; service packages use manual scheduling." action={<RefreshButton onClick={reload} loading={loading} />} />
      <SectionError message={error} />
      <PanelHeader kicker="Clearstep AI" title="Workshops & sessions" />
      <div className={styles.actionGrid} aria-busy={loading}>
        <CourseCreateForm busy={busy === "course-create"} onSubmit={(payload) => doMutate({ operation: "course-create", action: "course_upsert", payload, success: "Draft course created.", invalidate: ["catalog", "analytics"] })} />
        <SessionCreateForm courses={courses} busy={busy === "session-create"} onSubmit={(payload) => doMutate({ operation: "session-create", action: "session_upsert", payload, success: "Session saved.", invalidate: ["catalog", "analytics"] })} />
      </div>
      {courses.length ? <div className={styles.courseGrid}>{courses.map((course, index) => <Panel className={styles.courseCard} key={course.id}>
        <div className={styles.courseNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</div><StatusBadge status={statusFor(course.status)} />
        <h3>{course.title}</h3><p>{course.summary}</p>
        <div className={styles.courseFooter}><span className={styles.coursePrice}><strong>{money(course.price_cents, course.currency)}</strong><button className={styles.priceEditButton} type="button" onClick={(event) => { const editor = event.currentTarget.closest(`.${styles.courseCard}`)?.querySelector<HTMLDetailsElement>(`details[data-price-editor]`); if (editor) { editor.open = true; editor.scrollIntoView({ block: "nearest" }); } }}>Edit price for {course.title}</button></span><span>{course.duration_minutes} minutes</span></div>
        <CatalogPriceEditor item={course} label="course" busy={busy === `course-price-${course.id}`} onSave={(priceCents) => doMutate({ operation: `course-price-${course.id}`, action: course.stripe_product_id ? "course_price_update" : "course_upsert", payload: course.stripe_product_id ? { course_id: course.id, price_cents: priceCents } : coursePayload({ ...course, price_cents: priceCents }, course.status), success: `Price updated for ${course.title}.`, invalidate: ["catalog", "analytics"] })} />
        <CatalogPaymentForm item={course} busy={busy === `course-payment-${course.id}`} onSave={(productId, priceId) => doMutate({ operation: `course-payment-${course.id}`, action: "course_upsert", payload: coursePayload(course, course.status, { productId, priceId }), success: `Stripe pricing verified and saved for ${course.title}.`, invalidate: ["catalog"] })} />
        <InlineSelect label={`Change status for ${course.title}`} value={course.status} options={["draft", "published", "archived"]} busy={busy === `course-${course.id}`} onSave={(status) => doMutate({ operation: `course-${course.id}`, action: "course_upsert", payload: coursePayload(course, status), success: `${course.title} is now ${status}.`, invalidate: ["catalog", "analytics"] })} />
      </Panel>)}</div> : error ? null : <EmptyState title="No courses yet" description="Create the first draft course with the form above." />}
      <Panel className={styles.tablePanel}>
        <div className={styles.panelHeaderWithAction}><div><p className={styles.panelKicker}>Schedule</p><h3>All sessions</h3></div></div>
        {sessions.length ? <TableRegion label="Workshop sessions"><table className={styles.table}><caption className={styles.srOnly}>Workshop sessions</caption><thead><tr><th scope="col">Date</th><th scope="col">Workshop</th><th scope="col">Format</th><th scope="col">Capacity</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{sessions.map((session) => <tr id={`session-${session.id}`} key={session.id}><td>{dateTime(session.start_at)}</td><td><strong>{session.courseTitle}</strong><small>{session.venue || "Online"}</small></td><td>{session.format.replaceAll("_", " ")}</td><td>{session.capacity}</td><td><StatusBadge status={statusFor(session.status)} /></td><td><div className={styles.tableActions}><button className={styles.tableButton} type="button" onClick={() => setSelectedSession(session)} aria-label={`View or edit ${session.courseTitle} on ${dateTime(session.start_at)}`}>View / edit</button><InlineSelect compact label={`Change session status for ${session.courseTitle} on ${dateTime(session.start_at)}`} value={session.status} options={["draft", "scheduled", "sold_out", "cancelled", "completed"]} busy={busy === `session-${session.id}`} onSave={(status) => doMutate({ operation: `session-${session.id}`, action: "session_upsert", payload: sessionPayload(session, status), success: "Session status updated.", invalidate: ["catalog", "analytics"] })} /></div></td></tr>)}</tbody></table></TableRegion> : <EmptyState title="No sessions yet" description="Add a draft session when a workshop date is ready." />}
      </Panel>
      <div className={styles.panelHeaderWithAction}>
        <div><p className={styles.panelKicker}>Plate &amp; Post</p><h2>Fixed service packages</h2></div>
      </div>
      <p className={styles.formNote}>Draft packages are available only to owner/admin staff for sandbox testing. Do not publish until package deliverables, turnaround, revisions, travel and product handling, usage rights, VAT treatment, and live Stripe configuration are approved.</p>
      {services.length ? <div className={styles.courseGrid}>{services.map((service, index) => <Panel className={styles.courseCard} key={service.catalog_item_id}>
        <div className={styles.courseNumber} aria-hidden="true">P{String(index + 1).padStart(2, "0")}</div><StatusBadge status={statusFor(service.status)} />
        <h3>{service.title}</h3><p>{service.summary}</p>
        <div className={styles.courseFooter}><span className={styles.coursePrice}><strong>{money(service.price_cents, service.currency)}</strong><button className={styles.priceEditButton} type="button" onClick={(event) => { const editor = event.currentTarget.closest(`.${styles.courseCard}`)?.querySelector<HTMLDetailsElement>(`details[data-price-editor]`); if (editor) { editor.open = true; editor.scrollIntoView({ block: "nearest" }); } }}>Edit price for {service.title}</button></span><span>Manual scheduling</span></div>
        <CatalogPriceEditor item={service} label="package" busy={busy === `service-price-${service.catalog_item_id}`} onSave={(priceCents) => doMutate({ operation: `service-price-${service.catalog_item_id}`, action: service.stripe_product_id ? "service_offering_price_update" : "service_offering_upsert", payload: service.stripe_product_id ? { catalog_item_id: service.catalog_item_id, price_cents: priceCents } : serviceOfferingPayload({ ...service, price_cents: priceCents }), success: `Price updated for ${service.title}.`, invalidate: ["catalog"] })} />
        <CatalogPaymentForm item={service} busy={busy === `service-payment-${service.catalog_item_id}`} onSave={(productId, priceId) => doMutate({ operation: `service-payment-${service.catalog_item_id}`, action: "service_offering_upsert", payload: serviceOfferingPayload(service, service.status, { productId, priceId }), success: `Stripe pricing verified and saved for ${service.title}.`, invalidate: ["catalog"] })} />
        <ServiceOfferingEditor service={service} busy={busy === `service-content-${service.catalog_item_id}`} onSave={(payload) => doMutate({ operation: `service-content-${service.catalog_item_id}`, action: "service_offering_upsert", payload, success: `${service.title} content updated.`, invalidate: ["catalog"] })} />
        <InlineSelect label={`Change status for ${service.title}`} value={service.status} options={["draft", "published", "archived"]} busy={busy === `service-status-${service.catalog_item_id}`} onSave={(status) => doMutate({ operation: `service-status-${service.catalog_item_id}`, action: "service_offering_upsert", payload: serviceOfferingPayload(service, serviceOfferingStatus(status)), success: `${service.title} is now ${status}.`, invalidate: ["catalog"] })} />
      </Panel>)}</div> : error ? null : <EmptyState title="No service packages" description="The three seeded Plate & Post drafts should appear after the BNC commerce migration is applied." />}
      {selectedSession ? <SessionDialog key={selectedSession.id} session={selectedSession} courses={courses} busy={busy === `session-edit-${selectedSession.id}`} onClose={() => setSelectedSession(null)} onSave={async (payload) => { const saved = await doMutate({ operation: `session-edit-${selectedSession.id}`, action: "session_upsert", payload, success: "Session updated.", invalidate: ["catalog", "analytics"] }); if (saved) setSelectedSession(null); return saved; }} /> : null}
    </section>
  );
}

function SessionDialog({ session, courses, busy, onClose, onSave }: { session: SessionWithCourse; courses: CourseRecord[]; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      const values = new FormData(event.currentTarget);
      const startAt = amsterdamLocalToIso(String(values.get("start_at")));
      const endAt = amsterdamLocalToIso(String(values.get("end_at")));
      assertEndAfterStart(startAt, endAt);
      await onSave({ id: session.id, course_id: String(values.get("course_id")), format: String(values.get("format")), start_at: startAt, end_at: endAt, timezone: "Europe/Amsterdam", venue: String(values.get("venue") ?? "").trim(), capacity: Number(values.get("capacity")), status: String(values.get("status")) });
    } catch (error) { setFormError(errorFromForm(error)); }
  }
  return <AccessibleDialog title={session.courseTitle} description="Workshop event details." busy={busy} onRequestClose={onClose}>{!editing ? <><dl className={styles.sessionDetails}><div><dt>Starts</dt><dd>{dateTime(session.start_at)}</dd></div><div><dt>Ends</dt><dd>{dateTime(session.end_at)}</dd></div><div><dt>Format</dt><dd>{statusFor(session.format).label}</dd></div><div><dt>Venue</dt><dd>{session.venue || "Online"}</dd></div><div><dt>Capacity</dt><dd>{session.capacity} places</dd></div><div><dt>Status</dt><dd><StatusBadge status={statusFor(session.status)} /></dd></div></dl><div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" onClick={onClose}>Close</button><button className={styles.primaryButton} type="button" onClick={() => setEditing(true)}>Edit event</button></div></> : <form className={styles.adminForm} onSubmit={(event) => void submit(event)}><FormError message={formError} /><div className={styles.formGrid}><label>Course<select name="course_id" required defaultValue={session.course_id}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>Format<select name="format" defaultValue={session.format}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required aria-describedby="session-time-help" defaultValue={toAmsterdamLocalInput(session.start_at)} /></label><label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required aria-describedby="session-time-help" defaultValue={toAmsterdamLocalInput(session.end_at)} /></label><label>Venue<input name="venue" defaultValue={session.venue ?? ""} placeholder="Leave blank for online" /></label><label>Capacity<input name="capacity" type="number" min="1" max="500" required defaultValue={session.capacity} /></label><label>Status<select name="status" defaultValue={session.status}>{["draft", "scheduled", "sold_out", "cancelled", "completed"].map((status) => <option key={status} value={status}>{statusFor(status).label}</option>)}</select></label></div><p className={styles.formNote} id="session-time-help">Times must be valid, unambiguous Europe/Amsterdam times. Sessions with occupied or paid history keep their identity locked.</p><div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel edit</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div></form>}</AccessibleDialog>;
}

function CourseCreateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const success = await onSubmit({ slug: String(values.get("slug") ?? "").trim().toLowerCase(), title: String(values.get("title") ?? "").trim(), summary: String(values.get("summary") ?? "").trim(), description: String(values.get("description") ?? "").trim(), outcomes: String(values.get("outcomes") ?? "").split("\n").map((value) => value.trim()).filter(Boolean), level: String(values.get("level") ?? "").trim(), audience: String(values.get("audience") ?? "").trim(), agenda: String(values.get("agenda") ?? "").split("\n").map((line) => { const [title, ...detail] = line.split("|"); return { title: title?.trim() ?? "", detail: detail.join("|").trim() }; }).filter((item) => item.title && item.detail), duration_minutes: Number(values.get("duration_minutes")), price_cents: Math.round(Number(values.get("price_euros")) * 100), stripe_product_id: "", stripe_price_id: "", status: "draft", seo_title: "", seo_description: "" });
    if (success) form.reset();
  }
  return <Panel className={styles.formPanel}><details><summary>Create a draft course</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><div className={styles.formGrid}><label>Title<input name="title" required maxLength={240} /></label><label>URL slug<input name="slug" required maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="slug-help" placeholder="practical-ai-basics" /></label><label className={styles.fullField}>Summary<input name="summary" required maxLength={1000} /></label><label className={styles.fullField}>Description<textarea name="description" required rows={3} maxLength={10000} /></label><label>Audience<input name="audience" required maxLength={2000} /></label><label>Level<input name="level" required maxLength={120} defaultValue="Beginner-friendly" /></label><label>Duration (minutes)<input name="duration_minutes" type="number" min="30" max="1440" required defaultValue="180" /></label><label>Price per person (EUR)<input name="price_euros" type="number" min="1" step="0.01" required /></label><label className={styles.fullField}>Outcomes, one per line<textarea name="outcomes" rows={3} required maxLength={10019} /></label><label className={styles.fullField}>Agenda, one step per line as Title | Detail<textarea name="agenda" rows={3} required maxLength={12419} placeholder="Start with the work | Choose a real task and define a useful result." /></label></div><p className={styles.formNote} id="slug-help">Use lower-case letters, numbers, and hyphens. Use no more than 20 outcomes or agenda steps.</p><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft course"}</button></form></details></Panel>;
}

type PricedCatalogItem = Pick<CourseRecord, "title" | "price_cents" | "currency" | "stripe_product_id" | "stripe_price_id">;

function ServiceOfferingEditor({ service, busy, onSave }: { service: ServiceOfferingRecord; busy: boolean; onSave: (payload: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const duration = String(values.get("duration_minutes") ?? "").trim();
    await onSave({
      ...serviceOfferingPayload(service),
      slug: String(values.get("slug") ?? "").trim().toLowerCase(),
      title: String(values.get("title") ?? "").trim(),
      summary: String(values.get("summary") ?? "").trim(),
      description: String(values.get("description") ?? "").trim(),
      outcomes: String(values.get("outcomes") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      audience: String(values.get("audience") ?? "").trim(),
      duration_minutes: duration ? Number(duration) : null,
      seo_title: String(values.get("seo_title") ?? "").trim(),
      seo_description: String(values.get("seo_description") ?? "").trim(),
    });
  }

  return <details className={styles.quoteForm}><summary>Edit package content</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><div className={styles.formGrid}><label>Title<input name="title" required maxLength={240} defaultValue={service.title} /></label><label>URL slug<input name="slug" required maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={service.slug} /></label><label className={styles.fullField}>Summary<input name="summary" required maxLength={1000} defaultValue={service.summary} /></label><label className={styles.fullField}>Description<textarea name="description" required rows={4} maxLength={10000} defaultValue={service.description} /></label><label className={styles.fullField}>Deliverables, one per line<textarea name="outcomes" rows={4} maxLength={10019} defaultValue={service.outcomes.join("\n")} /></label><label className={styles.fullField}>Audience<input name="audience" required maxLength={2000} defaultValue={service.audience} /></label><label>Duration (minutes, optional)<input name="duration_minutes" type="number" min="1" max="10080" defaultValue={service.duration_minutes ?? ""} /></label><label>SEO title<input name="seo_title" maxLength={240} defaultValue={service.seo_title ?? ""} /></label><label className={styles.fullField}>SEO description<textarea name="seo_description" rows={2} maxLength={1000} defaultValue={service.seo_description ?? ""} /></label></div><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Saving…" : "Save package content"}</button><p className={styles.formNote}>Fulfilment remains manual scheduling. Stripe identifiers, price, visibility, and publication status are preserved by this editor.</p></form></details>;
}

function CatalogPaymentForm({ item, busy, onSave }: { item: PricedCatalogItem; busy: boolean; onSave: (productId: string, priceId: string) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); await onSave(String(values.get("stripe_product_id") ?? "").trim(), String(values.get("stripe_price_id") ?? "").trim()); }
  return <details className={styles.quoteForm}><summary>Stripe pricing</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><label>Product ID<input name="stripe_product_id" required pattern="prod_[A-Za-z0-9]+" defaultValue={item.stripe_product_id ?? ""} /></label><label>Price ID<input name="stripe_price_id" required pattern="price_[A-Za-z0-9]+" defaultValue={item.stripe_price_id ?? ""} /></label><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and save"}</button><p className={styles.formNote}>The server verifies the active one-time EUR Price matches {money(item.price_cents, item.currency)} and uses inclusive tax behavior before saving.</p></form></details>;
}

function CatalogPriceEditor({ item, label, busy, onSave }: { item: PricedCatalogItem; label: string; busy: boolean; onSave: (priceCents: number) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const euros = Number(new FormData(event.currentTarget).get("price_euros")); if (Number.isFinite(euros)) await onSave(Math.round(euros * 100)); }
  return <details className={styles.priceEditor} data-price-editor><summary>Adjust {label} price</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><label>Price (EUR)<input name="price_euros" type="number" min="0.01" step="0.01" required defaultValue={(item.price_cents / 100).toFixed(2)} /></label><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Updating…" : "Update price"}</button><p className={styles.formNote}>{item.stripe_product_id ? "A new immutable, VAT-inclusive Stripe Price will be created for future checkouts. Existing payments are unchanged." : "This draft has no Stripe Product yet, so only the catalogue amount will change."}</p></form></details>;
}

function SessionCreateForm({ courses, busy, onSubmit }: { courses: CourseRecord[]; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [formError, setFormError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(null); const form = event.currentTarget; const values = new FormData(form);
    try { const startAt = amsterdamLocalToIso(String(values.get("start_at"))); const endAt = amsterdamLocalToIso(String(values.get("end_at"))); assertEndAfterStart(startAt, endAt); const success = await onSubmit({ course_id: String(values.get("course_id")), format: String(values.get("format")), start_at: startAt, end_at: endAt, timezone: "Europe/Amsterdam", venue: String(values.get("venue") ?? "").trim(), capacity: Number(values.get("capacity")), status: String(values.get("status")) }); if (success) form.reset(); } catch (error) { setFormError(errorFromForm(error)); }
  }
  return <Panel className={styles.formPanel}><details><summary>Add a workshop session</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><FormError message={formError} /><div className={styles.formGrid}><label>Course<select name="course_id" required defaultValue=""><option value="" disabled>Choose course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>Format<select name="format" defaultValue="in_person"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required aria-describedby="create-session-time-help" /></label><label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required aria-describedby="create-session-time-help" /></label><label>Venue<input name="venue" placeholder="Leave blank for online" /></label><label>Capacity<input name="capacity" type="number" min="1" max="500" required defaultValue="10" /></label><label>Status<select name="status" defaultValue="draft"><option value="draft">Draft</option><option value="scheduled">Scheduled</option></select></label></div><p className={styles.formNote} id="create-session-time-help">Use a valid, unambiguous Amsterdam time. Scheduling queues Google Calendar provisioning.</p><button className={styles.primaryButton} type="submit" disabled={busy || !courses.length}>{busy ? "Saving…" : "Save session"}</button></form></details></Panel>;
}

function InlineSelect({ label, value, options, busy, onSave, compact = false }: { label: string; value: string; options: string[]; busy: boolean; onSave: (value: string) => Promise<boolean>; compact?: boolean }) {
  return <InlineSelectControl key={value} label={label} value={value} options={options} busy={busy} onSave={onSave} compact={compact} />;
}

function InlineSelectControl({ label, value, options, busy, onSave, compact = false }: { label: string; value: string; options: string[]; busy: boolean; onSave: (value: string) => Promise<boolean>; compact?: boolean }) {
  const [selected, setSelected] = useState(value);
  return <div className={`${styles.inlineControl} ${compact ? styles.inlineControlCompact : ""}`}><label><span className={styles.srOnly}>{label}</span><select aria-label={label} value={selected} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option} value={option}>{statusFor(option).label}</option>)}</select></label><button type="button" disabled={busy || selected === value} onClick={() => void onSave(selected)} aria-label={`Save ${label}`}>{busy ? "Saving…" : "Save"}</button></div>;
}

function serviceOrderStatusOptions(order: ServiceOrderRecord) {
  const transitions: Record<ServiceOrderRecord["fulfillment_status"], ServiceOrderRecord["fulfillment_status"][]> = {
    new: ["contacted", "cancelled"],
    contacted: ["scheduled", "cancelled"],
    scheduled: ["in_progress", "cancelled"],
    in_progress: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  };
  return [order.fulfillment_status, ...transitions[order.fulfillment_status]];
}

export function BookingsSection() {
  const { client, busy, mutate } = useAdminWorkspace();
  const { items: enrollments, error, loading, reload, hasMore, loadingMore, loadMore } = useStaffPagedResource("bookings", "enrollments");
  const ordersLoader = useCallback(async () => arrayFrom<ServiceOrderRecord>(await invokeAdmin<unknown>(client, "service_orders_list", { limit: 100 }), "orders"), [client]);
  const { data: orderData, error: orderError, loading: ordersLoading, reload: reloadOrders } = useAdminResource("orders", ordersLoader);
  const orders = orderData ?? [];
  const confirmed = enrollments.filter((enrollment) => enrollment.status === "confirmed");
  const paidOrders = orders.filter((order) => order.payment_status === "paid");
  const refresh = () => { reload(); reloadOrders(); };

  return <section className={styles.section} aria-labelledby="bookings-title">
    <SectionHeader eyebrow="Customer purchases" title="Bookings & orders" description="Workshop enrolments and Plate & Post service orders share one protected operations view." action={<RefreshButton onClick={refresh} loading={loading || ordersLoading} />} />
    <SectionError message={error} />
    <SectionError message={orderError} />
    <div className={styles.bookingSummary}><div><span>Workshop bookings shown</span><strong>{enrollments.length}</strong></div><div><span>Paid service orders</span><strong>{paidOrders.length}</strong></div><div><span>Paid value shown</span><strong>{money(confirmed.reduce((sum, enrollment) => sum + enrollment.amount_cents, 0) + paidOrders.reduce((sum, order) => sum + order.amount_cents, 0))}</strong></div></div>
    <Panel className={styles.tablePanel}><PanelHeader kicker="Clearstep AI" title="Workshop bookings" />{enrollments.length ? <><TableRegion label="Recent workshop bookings"><table className={styles.table}><caption className={styles.srOnly}>Recent workshop bookings</caption><thead><tr><th scope="col">Attendee</th><th scope="col">Workshop</th><th scope="col">Session</th><th scope="col">Booked</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead><tbody>{enrollments.map((enrollment) => <tr key={enrollment.id}><td><strong>{enrollment.attendee_name || "Name not supplied"}</strong><small>{enrollment.attendee_email}</small></td><td>{enrollment.course_title}</td><td>{dateTime(enrollment.start_at)}</td><td>{dateTime(enrollment.booked_at)}</td><td>{money(enrollment.amount_cents, enrollment.currency)}</td><td><StatusBadge status={statusFor(enrollment.status)} /></td></tr>)}</tbody></table></TableRegion><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier bookings" /></> : error ? null : <EmptyState title="No workshop bookings yet" description="Verified Stripe webhook enrolments will appear here." />}</Panel>
    <Panel className={styles.tablePanel}><PanelHeader kicker="Plate & Post" title="Service orders" />{orders.length ? <TableRegion label="Recent Plate and Post orders"><table className={styles.table}><caption className={styles.srOnly}>Recent Plate and Post service orders</caption><thead><tr><th scope="col">Customer</th><th scope="col">Package</th><th scope="col">Ordered</th><th scope="col">Amount</th><th scope="col">Payment</th><th scope="col">Fulfilment</th><th scope="col">Action</th></tr></thead><tbody>{orders.map((order) => { const options = serviceOrderStatusOptions(order); return <tr key={order.id}><td><strong>{order.customer_email}</strong><small>Ref {order.id.slice(0, 8).toUpperCase()}</small></td><td>{order.service_title}</td><td>{dateTime(order.ordered_at)}</td><td>{money(order.amount_cents, order.currency)}</td><td><StatusBadge status={statusFor(order.payment_status)} /></td><td><StatusBadge status={statusFor(order.fulfillment_status)} /></td><td>{options.length > 1 ? <InlineSelect compact label={`Change fulfilment for ${order.service_title}, order ${order.id.slice(0, 8)}`} value={order.fulfillment_status} options={options} busy={busy === `service-order-${order.id}`} onSave={(status) => mutate({ operation: `service-order-${order.id}`, action: "service_order_fulfillment_update", payload: { order_id: order.id, status }, success: `${order.service_title} fulfilment updated.`, invalidate: ["orders"] })} /> : "—"}</td></tr>; })}</tbody></table></TableRegion> : orderError ? null : <EmptyState title="No service orders yet" description="Verified Plate & Post payments will appear here for manual scheduling." />}</Panel>
  </section>;
}

export function WaitlistSection() {
  const { busy, mutate } = useAdminWorkspace();
  const { items: entries, error, loading, reload, hasMore, loadingMore, loadMore } = useStaffPagedResource("waitlist", "waitlist");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const positions = useMemo(() => {
    const next = new Map<string, number>();
    const active = entries.filter((entry) => ["waiting", "offered"].includes(entry.status));
    for (const sessionId of new Set(active.map((entry) => entry.session_id))) active.filter((entry) => entry.session_id === sessionId).sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()).forEach((entry, index) => next.set(entry.id, index + 1));
    return next;
  }, [entries]);
  return <section className={styles.section} aria-labelledby="waitlist-title"><SectionHeader eyebrow="Capacity" title="Waitlist" description="FIFO positions and active 24-hour offers from the booking system." action={<RefreshButton onClick={reload} loading={loading} />} /><SectionError message={error} /><Panel className={styles.tablePanel}>{entries.length ? <><TableRegion label="Current workshop waitlist"><table className={styles.table}><caption className={styles.srOnly}>Current workshop waitlist</caption><thead><tr><th scope="col">Position</th><th scope="col">Person</th><th scope="col">Workshop</th><th scope="col">Joined</th><th scope="col">Offer expiry</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{entries.map((entry) => { const position = entry.position ?? positions.get(entry.id); const name = entry.full_name || entry.email; return <tr key={entry.id}><td>{position ? <span className={styles.priority}>{position}</span> : "—"}</td><td><strong>{entry.full_name || "Name not supplied"}</strong><small>{entry.email}</small></td><td><strong>{entry.course_title || entry.session_id}</strong><small>{entry.session_start_at ? dateTime(entry.session_start_at) : "Session details unavailable"}</small></td><td>{dateTime(entry.joined_at)}</td><td>{dateTime(entry.offer_expires_at)}</td><td><StatusBadge status={statusFor(entry.status)} /></td><td><div className={styles.tableActions}>{entry.status === "waiting" && position === 1 ? <button className={styles.tableButton} type="button" disabled={busy === `waitlist-${entry.id}`} onClick={() => void mutate({ operation: `waitlist-${entry.id}`, action: "waitlist_offer", payload: { entry_id: entry.id }, success: "A 24-hour place offer was created.", invalidate: ["waitlist", "analytics"] })} aria-label={`Offer a place to ${name}`}>Offer place</button> : null}{["waiting", "offered"].includes(entry.status) ? <button className={`${styles.tableButton} ${styles.dangerButton}`} type="button" disabled={busy === `waitlist-${entry.id}`} onClick={() => setPending({ operation: `waitlist-${entry.id}`, action: "waitlist_remove", payload: { entry_id: entry.id }, title: "Remove waitlist entry", description: `Remove ${name} from this workshop waitlist? This releases any active offer and seat hold.`, confirmLabel: "Remove entry", success: "Waitlist entry removed.", invalidate: ["waitlist", "analytics"], danger: true })} aria-label={`Remove ${name} from the waitlist`}>Remove</button> : null}</div></td></tr>; })}</tbody></table></TableRegion><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier waitlist entries" /></> : error ? null : <EmptyState title="No one is waiting" description="New FIFO waitlist entries will appear here automatically." />}</Panel><PendingActionDialog action={pending} onDismiss={() => setPending(null)} /></section>;
}

function QuoteHistory({ request, busy, onRequestSend }: { request: PrivateRequestRecord; busy: string | null; onRequestSend: (quote: QuoteRecord) => void }) {
  const { client } = useAdminWorkspace();
  const [quotes, setQuotes] = useState<QuoteRecord[]>(request.quotes);
  const [hasMore, setHasMore] = useState(Boolean(request.quotes_truncated));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    const cursorQuote = quotes[quotes.length - 1];
    if (!hasMore || loadingMore || !cursorQuote) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = parseQuotePage(await invokeAdmin<unknown>(client, "private_request_quotes_page", {
        request_id: request.id,
        cursor: { at: cursorQuote.created_at, id: cursorQuote.id },
        limit: 20,
      }));
      if (page.items.some((quote) => quote.request_id !== request.id)) {
        throw new Error("The quote-history response did not match this private request.");
      }
      setQuotes((current) => [...current, ...page.items]);
      setHasMore(Boolean(page.nextCursor));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Older quotes could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }, [client, hasMore, loadingMore, quotes, request.id]);

  if (!quotes.length) {
    return <EmptyState title="No quote yet" description="Create one after dates, scope and Stripe pricing are confirmed." />;
  }

  return (
    <div className={styles.quoteList}>
      {quotes.map((quote) => (
        <div key={quote.id}>
          <span><strong>{money(quote.amount_cents, quote.currency)}</strong><small>Valid through {dateOnly(quote.valid_until)}</small></span>
          <span className={styles.quoteActions}>
            <StatusBadge status={statusFor(quote.status)} />
            {["draft", "sent"].includes(quote.status) ? <button type="button" disabled={busy === `quote-send-${quote.id}`} onClick={() => onRequestSend(quote)}>{busy === `quote-send-${quote.id}` ? "Sending…" : quote.status === "sent" ? "Resend" : "Send"}</button> : null}
          </span>
        </div>
      ))}
      {hasMore ? <><p className={styles.formNote}>Showing {quotes.length} of {request.quote_count ?? "many"} quotes.</p><button className={styles.secondaryButton} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load older quotes"}</button></> : null}
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </div>
  );
}

function PrivateRequestCard({ request, busy, mutate, onPending }: { request: PrivateRequestRecord; busy: string | null; mutate: Mutate; onPending: (action: PendingAction) => void }) {
  const quoteHistoryKey = `${request.id}:${request.quotes.map((quote) => `${quote.id}:${quote.status}:${quote.sent_at ?? ""}`).join("|")}`;
  return (
    <Panel className={styles.requestCard}>
      <div className={styles.requestTopline}><StatusBadge status={statusFor(request.status)} /><strong>{request.attendee_count ? `${request.attendee_count} people` : "Team size open"}</strong></div>
      <h3>{request.organization}</h3>
      <p className={styles.requestContact}>{request.contact_name} · {request.email}</p>
      <p>{request.goals}</p>
      <div className={styles.requestMeta}><span>{request.preferred_format?.replaceAll("_", " ") || "Format open"}</span><span>{request.preferred_timing || "Timing open"}</span></div>
      <InlineSelect label={`Change request status for ${request.organization}`} value={request.status} options={["new", "contacted", "qualified", "quoted", "won", "lost", "archived"]} busy={busy === `request-${request.id}`} onSave={(status) => mutate({ operation: `request-${request.id}`, action: "private_request_update", payload: { request_id: request.id, status }, success: "Private request updated.", invalidate: ["private"] })} />
      <QuoteHistory
        key={quoteHistoryKey}
        request={request}
        busy={busy}
        onRequestSend={(quote) => onPending({
          operation: `quote-send-${quote.id}`,
          action: "quote_send",
          payload: { quote_id: quote.id },
          title: quote.status === "sent" ? "Resend quote" : "Send quote",
          description: `${quote.status === "sent" ? "Resend" : "Send"} this personal checkout link to ${request.email}?`,
          confirmLabel: quote.status === "sent" ? "Resend quote" : "Send quote",
          success: quote.status === "sent" ? "Quote email resent with a new checkout link." : "Quote email queued with a personal checkout link.",
          invalidate: ["private"],
        })}
      />
      <QuoteCreateForm request={request} busy={busy === `quote-${request.id}`} onSubmit={(payload) => mutate({ operation: `quote-${request.id}`, action: "quote_create", payload, success: "Draft quote and private session created.", invalidate: ["private", "catalog", "analytics"] })} />
    </Panel>
  );
}

export function PrivateRequestsSection() {
  const { busy, mutate } = useAdminWorkspace();
  const { items: requests, error, loading, reload, hasMore, loadingMore, loadMore } = useStaffPagedResource("private", "private_requests");
  const [pending, setPending] = useState<PendingAction | null>(null);
  return (
    <section className={styles.section} aria-labelledby="private-title">
      <SectionHeader eyebrow="Private workshops" title="Requests & quotes" description="Qualify company requests, prepare a private session and track quote status." action={<RefreshButton onClick={reload} loading={loading} />} />
      <SectionError message={error} />
      {requests.length ? <><div className={styles.requestGrid}>{requests.map((request) => <PrivateRequestCard key={request.id} request={request} busy={busy} mutate={mutate} onPending={setPending} />)}</div><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier private requests" /></> : error ? null : <EmptyState title="No private requests" description="Submitted company enquiries will appear here." />}
      <PendingActionDialog action={pending} onDismiss={() => setPending(null)} />
    </section>
  );
}

function QuoteCreateForm({ request, busy, onSubmit }: { request: PrivateRequestRecord; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [formError, setFormError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setFormError(null); const form = event.currentTarget; const values = new FormData(form); try { const startAt = amsterdamLocalToIso(String(values.get("start_at"))); const endAt = amsterdamLocalToIso(String(values.get("end_at"))); assertEndAfterStart(startAt, endAt); const payload = { request_id: request.id, course_title: String(values.get("course_title")), description: String(values.get("description")), outcomes: [], agenda: [], amount_cents: Math.round(Number(values.get("amount_euros")) * 100), stripe_product_id: String(values.get("stripe_product_id")), stripe_price_id: String(values.get("stripe_price_id")), start_at: startAt, end_at: endAt, timezone: "Europe/Amsterdam", format: String(values.get("format")), venue: String(values.get("venue") ?? ""), capacity: request.attendee_count ?? 1, valid_until: String(values.get("valid_until")) }; if (await onSubmit(payload)) form.reset(); } catch (error) { setFormError(errorFromForm(error)); } }
  return <details className={styles.quoteForm}><summary>Create draft quote</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><FormError message={formError} /><label>Workshop title<input name="course_title" required defaultValue={`Private AI workshop for ${request.organization}`} /></label><label>Scope<textarea name="description" required rows={3} defaultValue={request.goals} /></label><div className={styles.formGrid}><label>Amount (EUR)<input name="amount_euros" type="number" min="1" step="0.01" required /></label><label>Valid until<input name="valid_until" type="date" required /></label><label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required aria-describedby={`quote-time-help-${request.id}`} /></label><label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required aria-describedby={`quote-time-help-${request.id}`} /></label><label>Format<select name="format" defaultValue={request.preferred_format === "online" ? "online" : "in_person"}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Venue<input name="venue" /></label><label>Stripe Product ID<input name="stripe_product_id" required pattern="prod_[A-Za-z0-9]+" /></label><label>Stripe Price ID<input name="stripe_price_id" required pattern="price_[A-Za-z0-9]+" /></label></div><p className={styles.formNote} id={`quote-time-help-${request.id}`}>Use a valid, unambiguous Amsterdam time. The quote stays draft until you explicitly send its personal checkout link.</p><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft quote"}</button></form></details>;
}

export function CustomerRequestsSection() {
  const { busy, mutate, role } = useAdminWorkspace();
  const { items: requests, error, loading, reload, hasMore, loadingMore, loadMore } = useStaffPagedResource("requests", "customer_requests");
  return (
    <section className={styles.section} aria-labelledby="customer-requests-title">
      <SectionHeader
        eyebrow={role === "owner" ? "Owner access" : "Admin access"}
        title="Customer requests"
        description={role === "owner" ? "Review privacy, cancellation, and purchase-change requests returned by the protected queue." : "Review cancellation and purchase-change requests returned by the protected queue."}
        action={<RefreshButton onClick={reload} loading={loading} />}
      />
      <SectionError message={error} />
      <Panel className={styles.tablePanel}>
        {requests.length ? <><TableRegion label="Customer requests"><table className={styles.table}>
          <caption className={styles.srOnly}>Customer privacy, cancellation, and purchase-change requests</caption>
          <thead><tr><th scope="col">Kind</th><th scope="col">Submitted</th><th scope="col">Details</th><th scope="col">Status</th><th scope="col">Resolution</th></tr></thead>
          <tbody>{requests.map((request) => {
            const operation = `customer-request-${request.id}`;
            return <tr key={request.id}>
              <td><strong>{statusFor(request.kind).label}</strong><small>{request.enrollment_id ? `Workshop booking ${request.enrollment_id}` : request.service_order_id ? `Service order ${request.service_order_id}` : "No purchase reference"}</small></td>
              <td>{dateTime(request.created_at)}</td>
              <td>{request.details || "No additional details"}</td>
              <td><InlineSelect label={`Change status for ${request.kind} request submitted ${dateTime(request.created_at)}`} value={request.status} options={["submitted", "in_review", "awaiting_customer", "completed", "declined"]} busy={busy === operation} onSave={(status) => mutate({ operation, action: "customer_request_update", payload: { request_id: request.id, status, resolution_note: request.resolution_note ?? "" }, success: "Customer request updated.", invalidate: ["requests"] })} /></td>
              <td><ResolutionNoteForm request={request} busy={busy === operation} onSave={(resolutionNote) => mutate({ operation, action: "customer_request_update", payload: { request_id: request.id, status: request.status, resolution_note: resolutionNote }, success: "Customer request resolution note updated.", invalidate: ["requests"] })} /></td>
            </tr>;
          })}</tbody>
        </table></TableRegion><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier customer requests" /></> : error ? null : <EmptyState title="No customer requests" description="New privacy, cancellation, and purchase-change requests will appear here." />}
      </Panel>
    </section>
  );
}

function ResolutionNoteForm({ request, busy, onSave }: { request: CustomerRequest; busy: boolean; onSave: (resolutionNote: string) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const resolutionNote = String(new FormData(form).get("resolution_note") ?? "").trim();
    if (await onSave(resolutionNote)) form.closest("details")?.removeAttribute("open");
  }

  return <details className={styles.quoteForm}>
    <summary>{request.resolution_note || (request.resolved_at ? `Resolved ${dateTime(request.resolved_at)}` : "Add resolution note")}</summary>
    <form className={styles.adminForm} onSubmit={(event) => void submit(event)}>
      <label>Resolution note<textarea name="resolution_note" rows={3} maxLength={1000} defaultValue={request.resolution_note ?? ""} /></label>
      <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Saving…" : "Save resolution"}</button>
    </form>
  </details>;
}

export function TeamSection() {
  const { client, busy, mutate, sendInvite, viewer } = useAdminWorkspace();
  const loader = useCallback(async () => {
    const [staffResponse, inviteResponse] = await Promise.all([
      invokeAdmin<unknown>(client, "staff_list"),
      invokeAdmin<unknown>(client, "staff_invites_list"),
    ]);
    return {
      members: arrayFrom<StaffMemberRecord>(staffResponse, "staff", "members"),
      invitations: arrayFrom<StaffInvitationRecord>(inviteResponse, "invitations", "invites"),
    };
  }, [client]);
  const { data, error, loading, reload } = useAdminResource("team", loader);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <section className={styles.section} aria-labelledby="team-title">
      <SectionHeader eyebrow="Owner access" title="Team & invitations" description="Invite verified email addresses, review acceptance and keep permissions deliberate." action={<RefreshButton onClick={reload} loading={loading} />} />
      <SectionError message={error} />
      <div className={styles.teamGrid}>
        <Panel>
          <PanelHeader kicker={`${members.length} member${members.length === 1 ? "" : "s"}`} title="People with access" />
          {members.length ? <div className={styles.memberList}>{members.map((member) => (
            <div className={styles.member} key={member.id}>
              <span className={styles.memberAvatar} aria-hidden="true">{member.email.charAt(0).toUpperCase()}</span>
              <span><strong>{member.email}</strong><small>Active since {dateOnly(member.activated_at)}</small></span>
              {member.email.toLowerCase() === viewer.email.toLowerCase() ? <span className={styles.memberRole}><strong>{statusFor(member.role).label}</strong><small>{statusFor(member.status).label} · Current account</small></span> : <MemberControl member={member} busy={busy === `member-${member.id}`} onSave={(role, status) => mutate({ operation: `member-${member.id}`, action: "staff_update", payload: { staff_member_id: member.id, role, status }, success: "Team access updated.", invalidate: ["team"] })} />}
            </div>
          ))}</div> : error ? null : <EmptyState title="No team members returned" description="The verified owner should appear after the backend is initialized." />}
        </Panel>
        <Panel className={styles.invitePanel}>
          <InviteForm busy={busy === "invite"} onInvite={sendInvite} />
          {invitations.length ? <div className={styles.invitationList}>{invitations.map((invite) => {
            const expired = invite.status === "expired";
            return <div key={invite.id}>
              <span><strong>{invite.email}</strong><small>{statusFor(invite.role).label} · expires {dateTime(invite.expires_at)}</small></span>
              {invite.accepted_at ? <StatusBadge status={statusFor("accepted")} /> : invite.revoked_at ? <StatusBadge status={statusFor("revoked")} /> : expired ? <StatusBadge status={statusFor("expired")} /> : <button type="button" disabled={busy === `invite-${invite.id}`} onClick={() => setPending({ operation: `invite-${invite.id}`, action: "staff_invite_revoke", payload: { invite_id: invite.id }, title: "Revoke invitation", description: `Revoke the pending invitation for ${invite.email}?`, confirmLabel: "Revoke invitation", success: "Invitation revoked.", invalidate: ["team"], danger: true })} aria-label={`Revoke invitation for ${invite.email}`}>{busy === `invite-${invite.id}` ? "Revoking…" : "Revoke"}</button>}
            </div>;
          })}</div> : <EmptyState title="No pending invitations" description="New seven-day invitations will appear here." />}
        </Panel>
      </div>
      <PendingActionDialog action={pending} onDismiss={() => setPending(null)} />
    </section>
  );
}

function InviteForm({ busy, onInvite }: { busy: boolean; onInvite: (email: string, role: "admin" | "analyst") => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); if (await onInvite(String(values.get("email") ?? "").trim(), String(values.get("role")) as "admin" | "analyst")) form.reset(); }
  return <><p className={styles.panelKicker}>Invite someone</p><h3>Add a team member</h3><p>They receive a single-use link that expires after seven days and must accept while signed in with the invited verified email.</p><form className={styles.inviteForm} onSubmit={(event) => void submit(event)}><label>Work email<input name="email" type="email" required autoComplete="email" /></label><label>Role<select name="role" defaultValue="analyst"><option value="analyst">Analyst · Analytics only</option><option value="admin">Admin · Catalog, bookings, and orders</option></select></label><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button></form></>;
}

function MemberControl({ member, busy, onSave }: { member: StaffMemberRecord; busy: boolean; onSave: (role: StaffRole, status: string) => Promise<boolean> }) {
  return <MemberControlFields key={`${member.role}:${member.status}`} member={member} busy={busy} onSave={onSave} />;
}

function MemberControlFields({ member, busy, onSave }: { member: StaffMemberRecord; busy: boolean; onSave: (role: StaffRole, status: string) => Promise<boolean> }) {
  const [role, setRole] = useState<StaffRole>(member.role); const [status, setStatus] = useState(member.status);
  return <div className={styles.memberControls}><select aria-label={`Role for ${member.email}`} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="analyst">Analyst</option></select><select aria-label={`Status for ${member.email}`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="removed">Removed</option></select><button type="button" disabled={busy || (role === member.role && status === member.status)} onClick={() => void onSave(role, status)} aria-label={`Save role and status for ${member.email}`}>{busy ? "Saving…" : "Save"}</button></div>;
}

export function AuditSection() {
  const { items: events, error, loading, reload, hasMore, loadingMore, loadMore } = useStaffPagedResource("audit", "audit");
  return <section className={styles.section} aria-labelledby="audit-title"><SectionHeader eyebrow="Owner access" title="Audit log" description="Security and operational changes recorded by the backend." action={<RefreshButton onClick={reload} loading={loading} />} /><SectionError message={error} /><Panel>{events.length ? <><ol className={styles.auditList}>{events.map((event, index) => <li className={styles.auditItem} key={event.id}><span className={styles.auditLine} aria-hidden="true"><span>{index + 1}</span></span><div><strong>{event.action.replaceAll(/[._]/g, " ")}</strong><p>{event.target_type}{event.target_id ? ` · ${event.target_id}` : ""}</p></div><span className={styles.auditMeta}><strong>{event.actor_email || event.actor_user_id || "System"}</strong><time dateTime={event.occurred_at}>{dateTime(event.occurred_at)}</time></span></li>)}</ol><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier audit events" /></> : error ? null : <EmptyState title="No audit events" description="Important owner and automation actions will appear here." />}</Panel></section>;
}

export function IntegrationsSection() {
  const { client, busy, connectGoogle } = useAdminWorkspace();
  const loader = useCallback(async () => {
    const [operations, google] = await Promise.all([invokeAdmin<unknown>(client, "operations_status"), invokeAdmin<unknown>(client, "google_connection_status")]);
    return { integrations: arrayFrom<IntegrationRecord>(operations, "integrations"), google: arrayFrom<GoogleConnectionRecord>(google, "connections") };
  }, [client]);
  const { data, error, loading, reload } = useAdminResource("integrations", loader);
  const cards = useMemo(() => { const integrations = data?.integrations ?? []; const google = data?.google[0]; const mapped = integrations.map((integration) => ({ name: integration.integration.replaceAll("_", " "), status: integration.status, detail: integration.last_error || (integration.last_success_at ? `Last successful ${dateTime(integration.last_success_at)}` : "No successful run recorded"), failures: integration.consecutive_failures })); if (google) mapped.push({ name: "Google Workspace account", status: google.status, detail: `${google.connected_email} · updated ${dateTime(google.updated_at)}`, failures: 0 }); return mapped; }, [data]);
  return <section className={styles.section} aria-labelledby="integrations-title"><SectionHeader eyebrow="Owner access" title="Integrations" description="Connection health only—credentials and tokens are never displayed." action={<div className={styles.sectionButtons}><RefreshButton onClick={reload} loading={loading} /><button className={styles.primaryButton} type="button" disabled={busy === "google-connect"} onClick={() => void connectGoogle()}>{busy === "google-connect" ? "Opening Google…" : data?.google.length ? "Reconnect Google" : "Connect Google Workspace"}</button></div>} /><SectionError message={error} />{cards.length ? <div className={styles.integrationGrid}>{cards.map((integration) => <Panel className={styles.integrationCard} key={integration.name}><div className={styles.integrationMark} aria-hidden="true">{integration.name.slice(0, 2).toUpperCase()}</div><div className={styles.integrationContent}><div className={styles.integrationHeading}><div><h3>{statusFor(integration.name).label}</h3><p>{integration.failures ? `${integration.failures} consecutive failures` : "Operational status"}</p></div><StatusBadge status={statusFor(integration.status)} /></div><p>{integration.detail}</p></div></Panel>)}</div> : error ? null : <EmptyState title="No integration health recorded" description="Stripe, Gmail and Calendar checks will appear after their first configuration or run." />}<div className={styles.securityNote}><strong>Secrets stay server-side.</strong><p>This page receives account labels, status and timestamps only.</p></div></section>;
}

export function AutomationSection() {
  const { client, busy } = useAdminWorkspace();
  const { items: jobs, error: pageError, loading: pageLoading, reload: reloadJobs, hasMore, loadingMore, loadMore } = useStaffPagedResource("automation", "automation");
  const operationsLoader = useCallback(async () => {
    const operations = await invokeAdmin<unknown>(client, "operations_status");
    const operationRecord = isRecord(operations) ? operations : {};
    return { counts: isRecord(operationRecord.automation) ? Object.fromEntries(Object.entries(operationRecord.automation).map(([key, value]) => [key, Number(value) || 0])) : {}, failedEmailDeliveries: Number(operationRecord.failed_email_deliveries) || 0 };
  }, [client]);
  const { data: operationsData, error: operationsError, loading: operationsLoading, reload: reloadOperations } = useAdminResource("operations", operationsLoader);
  const error = pageError ?? operationsError;
  const loading = pageLoading || operationsLoading;
  const reload = useCallback(() => { reloadJobs(); reloadOperations(); }, [reloadJobs, reloadOperations]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  return <section className={styles.section} aria-labelledby="automation-title"><SectionHeader eyebrow="Operations" title="Automation queue" description="Monitor retry-safe calendar, email, alert and enrolment work." action={<RefreshButton onClick={reload} loading={loading} />} /><SectionError message={error} /><div className={styles.bookingSummary}><div><span>Pending</span><strong>{operationsData?.counts.pending ?? 0}</strong></div><div><span>Failed</span><strong>{operationsData?.counts.failed ?? 0}</strong></div><div><span>Email deliveries needing attention</span><strong>{operationsData?.failedEmailDeliveries ?? 0}</strong></div></div><Panel className={styles.tablePanel}>{jobs.length ? <><TableRegion label="Recent automation jobs"><table className={styles.table}><caption className={styles.srOnly}>Recent automation jobs</caption><thead><tr><th scope="col">Job</th><th scope="col">Created</th><th scope="col">Attempts</th><th scope="col">Available</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{jobs.map((job) => <AutomationRow job={job} busy={busy} key={job.id} onRequestAction={setPending} />)}</tbody></table></TableRegion><LoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={loadMore} label="Load earlier automation jobs" /></> : error ? null : <EmptyState title="No automation jobs" description="Queued enrolment work will appear here." />}</Panel><PendingActionDialog action={pending} onDismiss={() => setPending(null)} /></section>;
}

function AutomationRow({ job, busy, onRequestAction }: { job: AutomationJobRecord; busy: string | null; onRequestAction: (action: PendingAction) => void }) {
  const busyKey = job.status === "pending" ? `job-cancel-${job.id}` : `job-rerun-${job.id}`;
  const canConfirmSent = job.status === "failed" && job.email_delivery_status === "uncertain";
  const canRetryUnsent = job.status === "failed" && (canConfirmSent || job.email_delivery_status === "failed");
  return <tr><td><strong>{job.job_type.replaceAll("_", " ")}</strong><small>{job.last_error || "No error"}</small>{job.email_delivery_status ? <small>Email: {job.email_delivery_status}</small> : null}</td><td>{dateTime(job.created_at)}</td><td>{job.attempts} / {job.max_attempts}</td><td>{dateTime(job.available_at)}</td><td><StatusBadge status={statusFor(job.status)} /></td><td><div className={styles.tableActions}>{job.status === "pending" ? <button className={`${styles.tableButton} ${styles.dangerButton}`} type="button" disabled={busy === busyKey} onClick={() => onRequestAction({ operation: busyKey, action: "automation_job_cancel", payload: { job_id: job.id }, title: "Cancel automation job", description: `Cancel this pending ${job.job_type.replaceAll("_", " ")} job?`, confirmLabel: "Cancel job", success: "Automation job cancelled.", invalidate: ["automation", "integrations"], danger: true })}>Cancel</button> : null}{job.job_type !== "email" && ["failed", "completed", "cancelled"].includes(job.status) ? <button className={styles.tableButton} type="button" disabled={busy === busyKey} onClick={() => onRequestAction({ operation: busyKey, action: "automation_job_rerun", payload: { job_id: job.id }, title: "Rerun automation job", description: `Queue this ${job.job_type.replaceAll("_", " ")} job from the beginning?`, confirmLabel: "Queue rerun", success: "Automation job queued to rerun.", invalidate: ["automation", "integrations"] })}>Rerun</button> : null}{canConfirmSent ? <button className={styles.tableButton} type="button" disabled={busy === `email-confirm-${job.id}`} onClick={() => onRequestAction({ operation: `email-confirm-${job.id}`, action: "email_delivery_reconcile", payload: { job_id: job.id, resolution: "confirm_sent" }, title: "Confirm email delivery", description: "Check the Gmail Sent folder first. Confirm that this exact message was delivered?", confirmLabel: "Confirm sent", success: "Email delivery marked as sent.", invalidate: ["automation", "integrations"] })}>Confirm sent</button> : null}{canRetryUnsent ? <button className={styles.tableButton} type="button" disabled={busy === `email-retry-${job.id}`} onClick={() => onRequestAction({ operation: `email-retry-${job.id}`, action: "email_delivery_reconcile", payload: { job_id: job.id, resolution: "retry_unsent" }, title: "Retry undelivered email", description: "Check the Gmail Sent folder first. Retry only if this exact message was not delivered.", confirmLabel: "Verified unsent—retry", success: "Verified-unsent email queued for retry.", invalidate: ["automation", "integrations"] })}>Verified unsent—retry</button> : null}{job.status !== "pending" && job.job_type === "email" && !canRetryUnsent ? "Review delivery record" : null}</div></td></tr>;
}

function percent(value: number, total: number) { return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%"; }
function capitalize(value: AdminTone): string { return value.charAt(0).toUpperCase() + value.slice(1); }
