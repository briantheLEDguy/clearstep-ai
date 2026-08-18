"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { beginGoogleConnection, inviteStaff, invokeAdmin, type AdminAction } from "@/lib/admin/admin-api";
import {
  dateOnly,
  dateTime,
  isStaffRole,
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
  type SessionRecord,
  type StaffInvitationRecord,
  type StaffMemberRecord,
  type StaffRole,
  type WaitlistRecord,
} from "@/lib/admin/dashboard-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import styles from "@/app/admin/admin.module.css";

type Viewer = { id: string; email: string };
type SessionWithCourse = SessionRecord & { courseTitle: string };
type SectionKey = "catalog" | "bookings" | "waitlist" | "private" | "analytics" | "team" | "audit" | "integrations" | "automation";

type DashboardData = {
  role: StaffRole;
  courses: CourseRecord[];
  enrollments: EnrollmentRecord[];
  waitlist: WaitlistRecord[];
  privateRequests: PrivateRequestRecord[];
  analytics: AnalyticsSummary | null;
  staff: StaffMemberRecord[];
  invitations: StaffInvitationRecord[];
  audit: AuditRecord[];
  integrations: IntegrationRecord[];
  googleConnections: GoogleConnectionRecord[];
  automationJobs: AutomationJobRecord[];
  automationCounts: Record<string, number>;
  failedEmailDeliveries: number;
};

type Notice = { tone: "success" | "danger"; message: string };

const emptyData: DashboardData = {
  role: "analyst",
  courses: [],
  enrollments: [],
  waitlist: [],
  privateRequests: [],
  analytics: null,
  staff: [],
  invitations: [],
  audit: [],
  integrations: [],
  googleConnections: [],
  automationJobs: [],
  automationCounts: {},
  failedEmailDeliveries: 0,
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "This information is temporarily unavailable.";
}

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

function coursePayload(
  course: CourseRecord,
  status: string,
  stripeIds?: { productId: string; priceId: string },
) {
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

async function resolveRole(viewer: Viewer, client: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>) {
  try {
    const context = await invokeAdmin<unknown>(client, "staff_context");
    if (isRecord(context) && isStaffRole(context.role)) {
      return { role: context.role, staff: [] as StaffMemberRecord[] };
    }
  } catch {
    // Older deployments may not have staff_context yet. The staff list is a
    // safe fallback; the server still authorizes every later mutation.
  }

  try {
    const response = await invokeAdmin<unknown>(client, "staff_list");
    const staff = arrayFrom<StaffMemberRecord>(response, "staff", "members");
    const current = staff.find((member) => member.email.toLowerCase() === viewer.email.toLowerCase());
    if (current && isStaffRole(current.role)) return { role: current.role, staff };
  } catch {
    // An analyst is intentionally unable to list staff.
  }
  return { role: "analyst" as const, staff: [] as StaffMemberRecord[] };
}

export default function AdminDashboard({ viewer }: { viewer: Viewer }) {
  const client = getSupabaseBrowserClient();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [errors, setErrors] = useState<Partial<Record<SectionKey, string>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionWithCourse | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!client) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);

    const next: DashboardData = { ...emptyData };
    const nextErrors: Partial<Record<SectionKey, string>> = {};
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const resolved = await resolveRole(viewer, client);
    next.role = resolved.role;
    next.staff = resolved.staff;

    const load = async (key: SectionKey, action: AdminAction, payload: Record<string, unknown> = {}) => {
      try {
        return await invokeAdmin<unknown>(client, action, payload);
      } catch (error) {
        nextErrors[key] = errorText(error);
        return null;
      }
    };

    const analytics = await load("analytics", "analytics_summary", {
      from: from.toISOString(),
      to: now.toISOString(),
    });
    next.analytics = isRecord(analytics) ? analytics as unknown as AnalyticsSummary : null;

    if (resolved.role !== "analyst") {
      const [catalog, enrollments, waitlist, privateRequests] = await Promise.all([
        load("catalog", "catalog_list"),
        load("bookings", "enrollments_list"),
        load("waitlist", "waitlist_list"),
        load("private", "private_requests_list"),
      ]);
      next.courses = arrayFrom<CourseRecord>(catalog, "courses");
      next.enrollments = arrayFrom<EnrollmentRecord>(enrollments, "enrollments");
      next.waitlist = arrayFrom<WaitlistRecord>(waitlist, "entries", "waitlist");
      next.privateRequests = arrayFrom<PrivateRequestRecord>(privateRequests, "requests");
    }

    if (resolved.role === "owner") {
      const [staff, invitations, audit, operations, google, automation] = await Promise.all([
        resolved.staff.length ? Promise.resolve({ staff: resolved.staff }) : load("team", "staff_list"),
        load("team", "staff_invites_list"),
        load("audit", "audit_list"),
        load("integrations", "operations_status"),
        load("integrations", "google_connection_status"),
        load("automation", "automation_jobs_list"),
      ]);
      next.staff = arrayFrom<StaffMemberRecord>(staff, "staff", "members");
      next.invitations = arrayFrom<StaffInvitationRecord>(invitations, "invitations", "invites");
      next.audit = arrayFrom<AuditRecord>(audit, "events", "audit", "logs");
      next.integrations = arrayFrom<IntegrationRecord>(operations, "integrations");
      next.googleConnections = arrayFrom<GoogleConnectionRecord>(google, "connections");
      next.automationJobs = arrayFrom<AutomationJobRecord>(automation, "jobs");
      if (isRecord(operations)) {
        next.automationCounts = isRecord(operations.automation)
          ? Object.fromEntries(Object.entries(operations.automation).map(([key, value]) => [key, Number(value) || 0]))
          : {};
        const emailDeliveriesNeedingAttention = next.automationJobs.filter((job) =>
          job.email_delivery_status === "failed" || job.email_delivery_status === "uncertain"
        ).length;
        next.failedEmailDeliveries = Math.max(
          Number(operations.failed_email_deliveries) || 0,
          emailDeliveriesNeedingAttention,
        );
      }
    }

    setData(next);
    setErrors(nextErrors);
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [client, viewer]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const mutate = useCallback(async (
    operation: string,
    action: AdminAction,
    payload: Record<string, unknown>,
    success: string,
  ) => {
    if (!client) return false;
    setBusy(operation);
    setNotice(null);
    try {
      await invokeAdmin(client, action, payload);
      setNotice({ tone: "success", message: success });
      await refresh(true);
      return true;
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const sendInvite = useCallback(async (email: string, role: "admin" | "analyst") => {
    if (!client) return false;
    setBusy("invite");
    setNotice(null);
    try {
      await inviteStaff(client, email, role);
      setNotice({ tone: "success", message: `Invitation sent to ${email}.` });
      await refresh(true);
      return true;
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  const connectGoogle = useCallback(async () => {
    if (!client) return;
    setBusy("google-connect");
    setNotice(null);
    try {
      const url = await beginGoogleConnection(client);
      window.location.assign(url);
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      setBusy(null);
    }
  }, [client]);

  if (loading) {
    return (
      <main className={styles.loadingScreen} aria-live="polite">
        <Image src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" priority />
        <h1>Staff workspace</h1>
        <p>Loading live workshop information…</p>
      </main>
    );
  }

  const canManage = data.role === "owner" || data.role === "admin";
  const isOwner = data.role === "owner";
  const referenceTime = lastUpdated?.getTime() ?? 0;
  const sessions = data.courses.flatMap((course) => course.sessions.map((session) => ({ ...session, courseTitle: course.title })));
  const upcoming = sessions
    .filter((session) => new Date(session.start_at).getTime() > referenceTime)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const waiting = data.waitlist.filter((entry) => entry.status === "waiting").length;
  const failedJobs = data.automationCounts.failed ?? data.automationJobs.filter((job) => job.status === "failed").length;
  const brokenIntegrations = data.integrations.filter((integration) => ["degraded", "failing"].includes(integration.status)).length;
  const navigation = [
    { label: "Overview", href: "#overview", short: "OV", visible: true },
    { label: "Courses & sessions", href: "#courses", short: "CS", visible: canManage },
    { label: "Bookings", href: "#bookings", short: "BK", visible: canManage },
    { label: "Waitlist", href: "#waitlist", short: "WL", visible: canManage },
    { label: "Private requests", href: "#private-requests", short: "PR", visible: canManage },
    { label: "Analytics", href: "#analytics", short: "AN", visible: true },
    { label: "Team", href: "#team", short: "TM", visible: isOwner },
    { label: "Audit log", href: "#audit", short: "AU", visible: isOwner },
    { label: "Integrations", href: "#integrations", short: "IN", visible: isOwner },
    { label: "Automation", href: "#automation", short: "AT", visible: isOwner },
  ].filter((item) => item.visible);

  return (
    <div className={styles.adminShell}>
      <aside className={styles.sidebar}>
        <Link className={styles.adminBrand} href="/" aria-label="Clearstep AI website">
          <Image src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" priority />
          <span>Staff workspace</span>
        </Link>
        <nav className={styles.adminNav} aria-label="Staff workspace navigation">
          {navigation.map((item, index) => (
            <a className={index === 0 ? styles.activeNavItem : styles.navItem} href={item.href} key={item.href}>
              <span aria-hidden="true">{item.short}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.livePill}>Live workspace</span>
          <p>Customer, booking and analytics data comes from Clearstep&apos;s protected Supabase project.</p>
          <Link href="/">View public website <span aria-hidden="true">↗</span></Link>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.topbarContext}>Clearstep AI</p>
            <h1 className={styles.topbarTitle}>Workshop operations</h1>
          </div>
          <div className={styles.topbarActions}>
            <button className={styles.refreshButton} type="button" disabled={refreshing} onClick={() => void refresh(true)}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <div className={styles.profile}>
              <span className={styles.profileAvatar} aria-hidden="true">{viewer.email.charAt(0).toUpperCase()}</span>
              <span><strong>{viewer.email}</strong><small>{data.role}</small></span>
            </div>
          </div>
        </header>

        <div className={styles.content}>
          {notice ? (
            <div className={`${styles.notice} ${notice.tone === "danger" ? styles.noticeDanger : styles.noticeSuccess}`} role="status" aria-live="polite">
              <strong>{notice.tone === "danger" ? "Action not completed" : "Saved"}</strong>
              <span>{notice.message}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
            </div>
          ) : null}

          <section className={styles.section} id="overview">
            <SectionHeader
              eyebrow={lastUpdated ? `Updated ${dateTime(lastUpdated.toISOString())}` : "Live workspace"}
              title={`Welcome, ${viewer.email.split("@")[0]}`}
              description={data.role === "analyst" ? "Your analytics access is read-only." : "Here is the current position across Clearstep workshops and operations."}
              action={canManage ? <a className={styles.primaryLink} href="#courses">Plan a session</a> : undefined}
            />
            <div className={styles.metricGrid}>
              <Metric label="Confirmed (30 days)" value={String(data.analytics?.confirmed_enrollments ?? 0)} detail="Paid enrolments" tone="success" />
              <Metric label="Upcoming sessions" value={String(upcoming.length)} detail="Scheduled dates" tone="info" />
              <Metric label="Waiting for a place" value={canManage ? String(waiting) : "—"} detail={canManage ? "Current FIFO entries" : "Restricted"} tone="warning" />
              <Metric label="Revenue (30 days)" value={money(data.analytics?.revenue_cents ?? 0)} detail="VAT-inclusive paid value" tone="neutral" />
            </div>
            {canManage ? (
              <div className={styles.overviewGrid}>
                <Panel>
                  <PanelHeader kicker="Schedule" title="Next sessions" />
                  {upcoming.length ? (
                    <div className={styles.scheduleList}>
                      {upcoming.slice(0, 4).map((session) => (
                        <button className={styles.scheduleItem} key={session.id} type="button" onClick={() => setSelectedSession(session)} aria-label={`View and edit ${session.courseTitle} on ${dateTime(session.start_at)}`}>
                          <time dateTime={session.start_at} className={styles.dateTile}>
                            <strong>{new Date(session.start_at).toLocaleDateString("en-NL", { day: "numeric", timeZone: "Europe/Amsterdam" })}</strong>
                            <span>{new Date(session.start_at).toLocaleDateString("en-NL", { month: "short", timeZone: "Europe/Amsterdam" })}</span>
                          </time>
                          <div className={styles.scheduleCopy}><strong>{session.courseTitle}</strong><span>{session.venue || "Online"} · {dateTime(session.start_at)}</span></div>
                          <div className={styles.scheduleCapacity}><strong>{session.capacity}</strong><span>places</span></div>
                        </button>
                      ))}
                    </div>
                  ) : <EmptyState title="No upcoming sessions" description="Create a draft session when the next date is ready." />}
                </Panel>
                <Panel>
                  <PanelHeader kicker="Operational health" title="Needs attention" />
                  <div className={styles.attentionList}>
                    <Attention href="#private-requests" label="New private requests" value={data.privateRequests.filter((request) => request.status === "new").length} tone="info" />
                    {isOwner ? <Attention href="#integrations" label="Integration warnings" value={brokenIntegrations} tone={brokenIntegrations ? "danger" : "success"} /> : null}
                    {isOwner ? <Attention href="#automation" label="Failed automation jobs" value={failedJobs} tone={failedJobs ? "danger" : "success"} /> : null}
                  </div>
                </Panel>
              </div>
            ) : null}
          </section>

          {canManage ? (
            <CatalogSection
              courses={data.courses}
              error={errors.catalog}
              busy={busy}
              onMutate={mutate}
              onEditSession={setSelectedSession}
            />
          ) : null}

          {canManage ? <BookingsSection enrollments={data.enrollments} error={errors.bookings} /> : null}
          {canManage ? <WaitlistSection entries={data.waitlist} error={errors.waitlist} busy={busy} onMutate={mutate} /> : null}
          {canManage ? (
            <PrivateRequestsSection requests={data.privateRequests} error={errors.private} busy={busy} onMutate={mutate} />
          ) : null}

          <AnalyticsSection analytics={data.analytics} error={errors.analytics} />

          {isOwner ? (
            <TeamSection
              members={data.staff}
              invitations={data.invitations}
              error={errors.team}
              busy={busy}
              viewerEmail={viewer.email}
              referenceTime={referenceTime}
              onInvite={sendInvite}
              onMutate={mutate}
            />
          ) : null}
          {isOwner ? <AuditSection events={data.audit} error={errors.audit} /> : null}
          {isOwner ? (
            <IntegrationsSection
              integrations={data.integrations}
              googleConnections={data.googleConnections}
              error={errors.integrations}
              busy={busy}
              canConnect={isOwner}
              onConnectGoogle={connectGoogle}
            />
          ) : null}
          {isOwner ? (
            <AutomationSection jobs={data.automationJobs} counts={data.automationCounts} failedEmailDeliveries={data.failedEmailDeliveries} error={errors.automation} busy={busy} onMutate={mutate} />
          ) : null}

          {selectedSession ? (
            <SessionDialog
              key={selectedSession.id}
              session={selectedSession}
              courses={data.courses}
              busy={busy === `session-edit-${selectedSession.id}`}
              onClose={() => setSelectedSession(null)}
              onSave={async (payload) => {
                const saved = await mutate(`session-edit-${selectedSession.id}`, "session_upsert", payload, "Session updated.");
                if (saved) setSelectedSession(null);
                return saved;
              }}
            />
          ) : null}

          <footer className={styles.adminFooter}>
            <span>Clearstep AI staff workspace</span>
            <span>Europe/Amsterdam · Role-checked server actions</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className={styles.sectionHeader}>
      <div><p className={styles.eyebrow}>{eyebrow}</p><h2 className={styles.sectionTitle}>{title}</h2><p className={styles.sectionDescription}>{description}</p></div>
      {action ? <div className={styles.sectionAction}>{action}</div> : null}
    </div>
  );
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

function SectionError({ message }: { message?: string }) {
  return message ? <div className={styles.sectionError} role="status"><strong>Information unavailable</strong><span>{message}</span></div> : null;
}

function Attention({ href, label, value, tone }: { href: string; label: string; value: number; tone: AdminTone }) {
  return <a className={styles.attentionItem} href={href}><span className={`${styles.attentionMarker} ${styles[`tone${capitalize(tone)}`]}`} aria-hidden="true" /><span><strong>{label}</strong><small>{value ? `${value} item${value === 1 ? "" : "s"} need attention` : "Nothing currently needs attention"}</small></span><span className={styles.arrow} aria-hidden="true">→</span></a>;
}

type Mutate = (operation: string, action: AdminAction, payload: Record<string, unknown>, success: string) => Promise<boolean>;

function CatalogSection({ courses, error, busy, onMutate, onEditSession }: { courses: CourseRecord[]; error?: string; busy: string | null; onMutate: Mutate; onEditSession: (session: SessionWithCourse) => void }) {
  const sessions = courses.flatMap((course) => course.sessions.map((session) => ({ ...session, courseTitle: course.title })));
  return (
    <section className={styles.section} id="courses">
      <SectionHeader eyebrow="Programme" title="Courses & sessions" description="Manage the live catalogue and schedule. Publishing a session queues its calendar setup." />
      <SectionError message={error} />
      <div className={styles.actionGrid}>
        <CourseCreateForm busy={busy === "course-create"} onSubmit={(payload) => onMutate("course-create", "course_upsert", payload, "Draft course created.")} />
        <SessionCreateForm courses={courses} busy={busy === "session-create"} onSubmit={(payload) => onMutate("session-create", "session_upsert", payload, "Session saved.")} />
      </div>
      {courses.length ? (
        <div className={styles.courseGrid}>
          {courses.map((course, index) => (
            <Panel className={styles.courseCard} key={course.id}>
              <div className={styles.courseNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
              <StatusBadge status={statusFor(course.status)} />
              <h3>{course.title}</h3><p>{course.summary}</p>
              <div className={styles.courseFooter}><span className={styles.coursePrice}><strong>{money(course.price_cents, course.currency)}</strong><button className={styles.priceEditButton} type="button" onClick={(event) => { const editor = event.currentTarget.closest(`.${styles.courseCard}`)?.querySelector<HTMLDetailsElement>(`details[data-price-editor]`); if (editor) { editor.open = true; editor.scrollIntoView({ block: "nearest" }); } }}>Edit price</button></span><span>{course.duration_minutes} minutes</span></div>
              <CoursePriceEditor
                course={course}
                busy={busy === `course-price-${course.id}`}
                onSave={(priceCents) => course.stripe_product_id
                  ? onMutate(
                    `course-price-${course.id}`,
                    "course_price_update",
                    { course_id: course.id, price_cents: priceCents },
                    `Price updated for ${course.title}.`,
                  )
                  : onMutate(
                    `course-price-${course.id}`,
                    "course_upsert",
                    coursePayload({ ...course, price_cents: priceCents }, course.status),
                    `Draft price updated for ${course.title}.`,
                  )}
              />
              <CoursePaymentForm
                course={course}
                busy={busy === `course-payment-${course.id}`}
                onSave={(productId, priceId) => onMutate(
                  `course-payment-${course.id}`,
                  "course_upsert",
                  coursePayload(course, course.status, { productId, priceId }),
                  `Stripe pricing verified and saved for ${course.title}.`,
                )}
              />
              <InlineSelect
                label={`Change status for ${course.title}`}
                value={course.status}
                options={["draft", "published", "archived"]}
                busy={busy === `course-${course.id}`}
                onSave={(status) => onMutate(`course-${course.id}`, "course_upsert", coursePayload(course, status), `${course.title} is now ${status}.`)}
              />
            </Panel>
          ))}
        </div>
      ) : error ? null : <EmptyState title="No courses yet" description="Create the first draft course with the form above." />}
      <Panel className={styles.tablePanel}>
        <div className={styles.panelHeaderWithAction}><div><p className={styles.panelKicker}>Schedule</p><h3>All sessions</h3></div></div>
        {sessions.length ? (
          <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Workshop sessions</caption><thead><tr><th>Date</th><th>Workshop</th><th>Format</th><th>Capacity</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {sessions.map((session) => <tr id={`session-${session.id}`} key={session.id}><td>{dateTime(session.start_at)}</td><td><strong>{session.courseTitle}</strong><small>{session.venue || "Online"}</small></td><td>{session.format.replaceAll("_", " ")}</td><td>{session.capacity}</td><td><StatusBadge status={statusFor(session.status)} /></td><td><div className={styles.tableActions}><button className={styles.tableButton} type="button" onClick={() => onEditSession(session)}>View / edit</button><InlineSelect compact label={`Change session status for ${session.courseTitle}`} value={session.status} options={["draft", "scheduled", "sold_out", "cancelled", "completed"]} busy={busy === `session-${session.id}`} onSave={(status) => onMutate(`session-${session.id}`, "session_upsert", sessionPayload(session, status), "Session status updated.")} /></div></td></tr>)}
          </tbody></table></div>
        ) : <EmptyState title="No sessions yet" description="Add a draft session when a workshop date is ready." />}
      </Panel>
    </section>
  );
}

function SessionDialog({ session, courses, busy, onClose, onSave }: { session: SessionWithCourse; courses: CourseRecord[]; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await onSave({
      id: session.id,
      course_id: String(values.get("course_id")),
      format: String(values.get("format")),
      start_at: amsterdamLocalToIso(String(values.get("start_at"))),
      end_at: amsterdamLocalToIso(String(values.get("end_at"))),
      timezone: "Europe/Amsterdam",
      venue: String(values.get("venue") ?? "").trim(),
      capacity: Number(values.get("capacity")),
      status: String(values.get("status")),
    });
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.sessionDialog} role="dialog" aria-modal="true" aria-labelledby="session-dialog-title">
        <div className={styles.dialogHeader}>
          <div><p className={styles.panelKicker}>Workshop event</p><h2 id="session-dialog-title">{session.courseTitle}</h2></div>
          <button className={styles.dialogClose} type="button" disabled={busy} onClick={onClose} aria-label="Close event details">×</button>
        </div>
        {!editing ? (
          <>
            <dl className={styles.sessionDetails}>
              <div><dt>Starts</dt><dd>{dateTime(session.start_at)}</dd></div>
              <div><dt>Ends</dt><dd>{dateTime(session.end_at)}</dd></div>
              <div><dt>Format</dt><dd>{statusFor(session.format).label}</dd></div>
              <div><dt>Venue</dt><dd>{session.venue || "Online"}</dd></div>
              <div><dt>Capacity</dt><dd>{session.capacity} places</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={statusFor(session.status)} /></dd></div>
            </dl>
            <div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" onClick={onClose}>Close</button><button className={styles.primaryButton} type="button" onClick={() => setEditing(true)}>Edit event</button></div>
          </>
        ) : (
          <form className={styles.adminForm} onSubmit={(event) => void submit(event)}>
            <div className={styles.formGrid}>
              <label>Course<select name="course_id" required defaultValue={session.course_id}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
              <label>Format<select name="format" defaultValue={session.format}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
              <label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required defaultValue={toAmsterdamLocalInput(session.start_at)} /></label>
              <label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required defaultValue={toAmsterdamLocalInput(session.end_at)} /></label>
              <label>Venue<input name="venue" defaultValue={session.venue ?? ""} placeholder="Leave blank for online" /></label>
              <label>Capacity<input name="capacity" type="number" min="1" max="500" required defaultValue={session.capacity} /></label>
              <label>Status<select name="status" defaultValue={session.status}>{["draft", "scheduled", "sold_out", "cancelled", "completed"].map((status) => <option key={status} value={status}>{statusFor(status).label}</option>)}</select></label>
            </div>
            <p className={styles.formNote}>Sessions with occupied or paid booking history keep their date, format, venue, course and status locked; capacity can only increase above occupied seats.</p>
            <div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel edit</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

function CourseCreateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const euros = Number(values.get("price_euros"));
    const success = await onSubmit({
      slug: String(values.get("slug") ?? "").trim().toLowerCase(),
      title: String(values.get("title") ?? "").trim(),
      summary: String(values.get("summary") ?? "").trim(),
      description: String(values.get("description") ?? "").trim(),
      outcomes: String(values.get("outcomes") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      level: String(values.get("level") ?? "").trim(),
      audience: String(values.get("audience") ?? "").trim(),
      agenda: String(values.get("agenda") ?? "").split("\n").map((line) => {
        const [title, ...detail] = line.split("|");
        return { title: title?.trim() ?? "", detail: detail.join("|").trim() };
      }).filter((item) => item.title && item.detail),
      duration_minutes: Number(values.get("duration_minutes")),
      price_cents: Math.round(euros * 100),
      stripe_product_id: "",
      stripe_price_id: "",
      status: "draft",
      seo_title: "",
      seo_description: "",
    });
    if (success) form.reset();
  }
  return <Panel className={styles.formPanel}><details><summary>Create a draft course</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><div className={styles.formGrid}><label>Title<input name="title" required maxLength={240} /></label><label>URL slug<input name="slug" required maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="practical-ai-basics" /></label><label className={styles.fullField}>Summary<input name="summary" required maxLength={1000} /></label><label className={styles.fullField}>Description<textarea name="description" required rows={3} maxLength={10000} /></label><label>Audience<input name="audience" required maxLength={2000} /></label><label>Level<input name="level" required maxLength={120} defaultValue="Beginner-friendly" /></label><label>Duration (minutes)<input name="duration_minutes" type="number" min="30" max="1440" required defaultValue="180" /></label><label>Price per person (EUR)<input name="price_euros" type="number" min="1" step="0.01" required /></label><label className={styles.fullField}>Outcomes, one per line<textarea name="outcomes" rows={3} required maxLength={10019} /></label><label className={styles.fullField}>Agenda, one step per line as Title | Detail<textarea name="agenda" rows={3} required maxLength={12419} placeholder="Start with the work | Choose a real task and define a useful result." /></label></div><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft course"}</button><p className={styles.formNote}>Use no more than 20 outcomes or agenda steps. Stripe Product and Price IDs can be added during payment setup; this form cannot publish a course.</p></form></details></Panel>;
}

function CoursePaymentForm({ course, busy, onSave }: { course: CourseRecord; busy: boolean; onSave: (productId: string, priceId: string) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await onSave(String(values.get("stripe_product_id") ?? "").trim(), String(values.get("stripe_price_id") ?? "").trim());
  }

  return <details className={styles.quoteForm}><summary>Stripe pricing</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><label>Product ID<input name="stripe_product_id" required pattern="prod_[A-Za-z0-9]+" defaultValue={course.stripe_product_id ?? ""} /></label><label>Price ID<input name="stripe_price_id" required pattern="price_[A-Za-z0-9]+" defaultValue={course.stripe_price_id ?? ""} /></label><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and save"}</button><p className={styles.formNote}>The server verifies the active EUR Price matches {money(course.price_cents, course.currency)} before saving.</p></form></details>;
}

function CoursePriceEditor({ course, busy, onSave }: { course: CourseRecord; busy: boolean; onSave: (priceCents: number) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const euros = Number(new FormData(event.currentTarget).get("price_euros"));
    if (!Number.isFinite(euros)) return;
    await onSave(Math.round(euros * 100));
  }

  return (
    <details className={styles.priceEditor} data-price-editor>
      <summary>Adjust course price</summary>
      <form className={styles.adminForm} onSubmit={(event) => void submit(event)}>
        <label>Price per person (EUR)<input name="price_euros" type="number" min="0.01" step="0.01" required defaultValue={(course.price_cents / 100).toFixed(2)} /></label>
        <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Updating…" : "Update price"}</button>
        <p className={styles.formNote}>{course.stripe_product_id ? "A new immutable, VAT-inclusive Stripe Price will be created for future checkouts. Existing payments are unchanged." : "This draft has no Stripe Product yet, so only the catalogue amount will change."}</p>
      </form>
    </details>
  );
}

function SessionCreateForm({ courses, busy, onSubmit }: { courses: CourseRecord[]; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const success = await onSubmit({ course_id: String(values.get("course_id")), format: String(values.get("format")), start_at: amsterdamLocalToIso(String(values.get("start_at"))), end_at: amsterdamLocalToIso(String(values.get("end_at"))), timezone: "Europe/Amsterdam", venue: String(values.get("venue") ?? "").trim(), capacity: Number(values.get("capacity")), status: String(values.get("status")) });
    if (success) form.reset();
  }
  return <Panel className={styles.formPanel}><details><summary>Add a workshop session</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><div className={styles.formGrid}><label>Course<select name="course_id" required defaultValue=""><option value="" disabled>Choose course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>Format<select name="format" defaultValue="in_person"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required /></label><label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required /></label><label>Venue<input name="venue" placeholder="Leave blank for online" /></label><label>Capacity<input name="capacity" type="number" min="1" max="500" required defaultValue="10" /></label><label>Status<select name="status" defaultValue="draft"><option value="draft">Draft</option><option value="scheduled">Scheduled</option></select></label></div><button className={styles.primaryButton} type="submit" disabled={busy || !courses.length}>{busy ? "Saving…" : "Save session"}</button><p className={styles.formNote}>Scheduling immediately queues Google Calendar provisioning. Keep it draft until the date and integration are ready.</p></form></details></Panel>;
}

function InlineSelect({ label, value, options, busy, onSave, compact = false }: { label: string; value: string; options: string[]; busy: boolean; onSave: (value: string) => Promise<boolean>; compact?: boolean }) {
  const [selected, setSelected] = useState(value);
  return <div className={`${styles.inlineControl} ${compact ? styles.inlineControlCompact : ""}`}><label><span className={styles.srOnly}>{label}</span><select aria-label={label} value={selected} onChange={(event) => setSelected(event.target.value)}>{options.map((option) => <option key={option} value={option}>{statusFor(option).label}</option>)}</select></label><button type="button" disabled={busy || selected === value} onClick={() => void onSave(selected)}>{busy ? "Saving…" : "Save"}</button></div>;
}

function BookingsSection({ enrollments, error }: { enrollments: EnrollmentRecord[]; error?: string }) {
  const confirmed = enrollments.filter((enrollment) => enrollment.status === "confirmed");
  return <section className={styles.section} id="bookings"><SectionHeader eyebrow="Enrolment" title="Bookings" description="Payment-confirmed and pending enrolments returned by the protected staff endpoint." /><SectionError message={error} /><div className={styles.bookingSummary}><div><span>Records shown</span><strong>{enrollments.length}</strong></div><div><span>Confirmed</span><strong>{confirmed.length}</strong></div><div><span>Confirmed value</span><strong>{money(confirmed.reduce((sum, enrollment) => sum + enrollment.amount_cents, 0))}</strong></div></div><Panel className={styles.tablePanel}>{enrollments.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Recent workshop bookings</caption><thead><tr><th>Attendee</th><th>Workshop</th><th>Session</th><th>Booked</th><th>Amount</th><th>Status</th></tr></thead><tbody>{enrollments.map((enrollment) => <tr key={enrollment.id}><td><strong>{enrollment.attendee_name || "Name not supplied"}</strong><small>{enrollment.attendee_email}</small></td><td>{enrollment.course_title}</td><td>{dateTime(enrollment.start_at)}</td><td>{dateTime(enrollment.booked_at)}</td><td>{money(enrollment.amount_cents, enrollment.currency)}</td><td><StatusBadge status={statusFor(enrollment.status)} /></td></tr>)}</tbody></table></div> : error ? null : <EmptyState title="No bookings yet" description="Verified Stripe webhook enrolments will appear here." />}</Panel></section>;
}

function WaitlistSection({ entries, error, busy, onMutate }: { entries: WaitlistRecord[]; error?: string; busy: string | null; onMutate: Mutate }) {
  const positionById = new Map<string, number>();
  const activeEntries = entries.filter((entry) => ["waiting", "offered"].includes(entry.status));
  for (const sessionId of new Set(activeEntries.map((entry) => entry.session_id))) {
    activeEntries
      .filter((entry) => entry.session_id === sessionId)
      .sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())
      .forEach((entry, index) => positionById.set(entry.id, index + 1));
  }
  return <section className={styles.section} id="waitlist"><SectionHeader eyebrow="Capacity" title="Waitlist" description="FIFO positions and active 24-hour offers from the booking system." /><SectionError message={error} /><Panel className={styles.tablePanel}>{entries.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Current workshop waitlist</caption><thead><tr><th>Position</th><th>Person</th><th>Workshop</th><th>Joined</th><th>Offer expiry</th><th>Status</th><th>Action</th></tr></thead><tbody>{entries.map((entry) => { const position = entry.position ?? positionById.get(entry.id); return <tr key={entry.id}><td>{position ? <span className={styles.priority}>{position}</span> : "—"}</td><td><strong>{entry.full_name || "Name not supplied"}</strong><small>{entry.email}</small></td><td><strong>{entry.course_title || entry.session_id}</strong><small>{entry.session_start_at ? dateTime(entry.session_start_at) : "Session details unavailable"}</small></td><td>{dateTime(entry.joined_at)}</td><td>{dateTime(entry.offer_expires_at)}</td><td><StatusBadge status={statusFor(entry.status)} /></td><td><div className={styles.tableActions}>{entry.status === "waiting" && position === 1 ? <button className={styles.tableButton} type="button" disabled={busy === `waitlist-${entry.id}`} onClick={() => void onMutate(`waitlist-${entry.id}`, "waitlist_offer", { entry_id: entry.id }, "A 24-hour place offer was created.")}>Offer place</button> : null}{["waiting", "offered"].includes(entry.status) ? <button className={styles.tableButton} type="button" disabled={busy === `waitlist-${entry.id}`} onClick={() => void onMutate(`waitlist-${entry.id}`, "waitlist_remove", { entry_id: entry.id }, "Waitlist entry removed.")}>Remove</button> : null}</div></td></tr>; })}</tbody></table></div> : error ? null : <EmptyState title="No one is waiting" description="New FIFO waitlist entries will appear here automatically." />}</Panel></section>;
}

function PrivateRequestsSection({ requests, error, busy, onMutate }: { requests: PrivateRequestRecord[]; error?: string; busy: string | null; onMutate: Mutate }) {
  return <section className={styles.section} id="private-requests"><SectionHeader eyebrow="Private workshops" title="Requests & quotes" description="Qualify company requests, prepare a private session and track quote status." /><SectionError message={error} />{requests.length ? <div className={styles.requestGrid}>{requests.map((request) => <Panel className={styles.requestCard} key={request.id}><div className={styles.requestTopline}><StatusBadge status={statusFor(request.status)} /><strong>{request.attendee_count ? `${request.attendee_count} people` : "Team size open"}</strong></div><h3>{request.organization}</h3><p className={styles.requestContact}>{request.contact_name} · {request.email}</p><p>{request.goals}</p><div className={styles.requestMeta}><span>{request.preferred_format?.replaceAll("_", " ") || "Format open"}</span><span>{request.preferred_timing || "Timing open"}</span></div><InlineSelect label={`Change request status for ${request.organization}`} value={request.status} options={["new", "contacted", "qualified", "quoted", "won", "lost", "archived"]} busy={busy === `request-${request.id}`} onSave={(status) => onMutate(`request-${request.id}`, "private_request_update", { request_id: request.id, status }, "Private request updated.")} />{request.quotes?.length ? <div className={styles.quoteList}>{request.quotes.map((quote) => <div key={quote.id}><span><strong>{money(quote.amount_cents, quote.currency)}</strong><small>Valid through {dateOnly(quote.valid_until)}</small></span><span className={styles.quoteActions}><StatusBadge status={statusFor(quote.status)} />{["draft", "sent"].includes(quote.status) ? <button type="button" disabled={busy === `quote-send-${quote.id}`} onClick={() => { if (window.confirm(`${quote.status === "sent" ? "Resend" : "Send"} this ${money(quote.amount_cents, quote.currency)} quote to ${request.email}? A new personal checkout link will be emailed.`)) { void onMutate(`quote-send-${quote.id}`, "quote_send", { quote_id: quote.id }, quote.status === "sent" ? "Quote email resent with a new checkout link." : "Quote email queued with a personal checkout link."); } }}>{busy === `quote-send-${quote.id}` ? "Sending…" : quote.status === "sent" ? "Resend" : "Send"}</button> : null}</span></div>)}</div> : <EmptyState title="No quote yet" description="Create one after dates, scope and Stripe pricing are confirmed." />}<QuoteCreateForm request={request} busy={busy === `quote-${request.id}`} onSubmit={(payload) => onMutate(`quote-${request.id}`, "quote_create", payload, "Draft quote and private session created.")} /></Panel>)}</div> : error ? null : <EmptyState title="No private requests" description="Submitted company enquiries will appear here." />}</section>;
}

function QuoteCreateForm({ request, busy, onSubmit }: { request: PrivateRequestRecord; busy: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = { request_id: request.id, course_title: String(values.get("course_title")), description: String(values.get("description")), outcomes: [], agenda: [], amount_cents: Math.round(Number(values.get("amount_euros")) * 100), stripe_product_id: String(values.get("stripe_product_id")), stripe_price_id: String(values.get("stripe_price_id")), start_at: amsterdamLocalToIso(String(values.get("start_at"))), end_at: amsterdamLocalToIso(String(values.get("end_at"))), timezone: "Europe/Amsterdam", format: String(values.get("format")), venue: String(values.get("venue") ?? ""), capacity: request.attendee_count ?? 1, valid_until: String(values.get("valid_until")) };
    if (await onSubmit(payload)) form.reset();
  }
  return <details className={styles.quoteForm}><summary>Create draft quote</summary><form className={styles.adminForm} onSubmit={(event) => void submit(event)}><label>Workshop title<input name="course_title" required defaultValue={`Private AI workshop for ${request.organization}`} /></label><label>Scope<textarea name="description" required rows={3} defaultValue={request.goals} /></label><div className={styles.formGrid}><label>Amount (EUR)<input name="amount_euros" type="number" min="1" step="0.01" required /></label><label>Valid until<input name="valid_until" type="date" required /></label><label>Starts (Amsterdam)<input name="start_at" type="datetime-local" required /></label><label>Ends (Amsterdam)<input name="end_at" type="datetime-local" required /></label><label>Format<select name="format" defaultValue={request.preferred_format === "online" ? "online" : "in_person"}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Venue<input name="venue" /></label><label>Stripe Product ID<input name="stripe_product_id" required pattern="prod_[A-Za-z0-9]+" /></label><label>Stripe Price ID<input name="stripe_price_id" required pattern="price_[A-Za-z0-9]+" /></label></div><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft quote"}</button><p className={styles.formNote}>The quote stays draft until you explicitly send its personal checkout link.</p></form></details>;
}

function AnalyticsSection({ analytics, error }: { analytics: AnalyticsSummary | null; error?: string }) {
  const funnel = [
    { label: "Page views", value: analytics?.page_views ?? 0 },
    { label: "Workshop views", value: analytics?.course_views ?? 0 },
    { label: "Checkout starts", value: analytics?.checkout_starts ?? 0 },
    { label: "Paid bookings", value: analytics?.confirmed_enrollments ?? 0 },
  ];
  const max = Math.max(1, ...funnel.map((step) => step.value));
  const waitlistJoins = analytics?.waitlist_joins ?? 0;
  const waitlistAcceptances = analytics?.waitlist_acceptances ?? 0;
  const occupancy = analytics?.upcoming_occupancy ?? [];
  const utmSources = analytics?.utm_sources ?? [];

  return (
    <section className={styles.section} id="analytics">
      <SectionHeader eyebrow="Last 30 days" title="Analytics" description="First-party, privacy-friendly activity and verified enrolment results." action={<span className={styles.readOnlyLabel}>Read-only for analysts</span>} />
      <SectionError message={error} />
      {analytics ? (
        <>
          <div className={styles.analyticsMetrics}>
            <Panel><span>Page views</span><strong>{analytics.page_views}</strong><small>First-party events</small></Panel>
            <Panel><span>Workshop views</span><strong>{analytics.course_views}</strong><small>{percent(analytics.course_views, analytics.page_views)} of page views</small></Panel>
            <Panel><span>Checkout starts</span><strong>{analytics.checkout_starts}</strong><small>{percent(analytics.checkout_starts, analytics.course_views)} of workshop views</small></Panel>
            <Panel><span>Paid bookings</span><strong>{analytics.confirmed_enrollments}</strong><small>{money(analytics.net_revenue_cents, analytics.currency)} net revenue</small></Panel>
            <Panel><span>Private requests</span><strong>{analytics.private_requests}</strong><small>New enquiries</small></Panel>
            <Panel><span>Waitlist conversion</span><strong>{percent(waitlistAcceptances, waitlistJoins)}</strong><small>{waitlistAcceptances} accepted from {waitlistJoins} joins</small></Panel>
            <Panel><span>Refunds</span><strong>{analytics.refund_count}</strong><small>{money(analytics.refunded_cents, analytics.currency)} refunded</small></Panel>
            <Panel><span>Automation failures</span><strong>{analytics.automation_failures}</strong><small>Terminal jobs in this period</small></Panel>
          </div>
          <div className={styles.analyticsGrid}>
            <Panel>
              <PanelHeader kicker="Booking funnel" title="From visit to enrolment" />
              <div className={styles.funnel}>{funnel.map((step) => <div key={step.label} style={{ width: `${Math.max(28, Math.round((step.value / max) * 100))}%` }}><span>{step.label}</span><strong>{step.value}</strong></div>)}</div>
            </Panel>
            <Panel>
              <PanelHeader kicker="Interest" title="Most-viewed courses" />
              {analytics.top_courses.length ? <div className={styles.sourceList}>{analytics.top_courses.map((course) => <div className={styles.sourceRow} key={course.course_id ?? course.course_slug}><div><strong>{course.course_title || "Unattributed"}</strong><span>{course.views} views</span></div><div className={styles.sourceBar}><span style={{ width: `${Math.max(5, Math.round((course.views / Math.max(1, analytics.top_courses[0]?.views ?? 1)) * 100))}%` }} /></div></div>)}</div> : <EmptyState title="No workshop views yet" description="Course-view events will appear here after visitors browse workshops." />}
            </Panel>
            <Panel>
              <PanelHeader kicker="Capacity" title="Upcoming occupancy" />
              {occupancy.length ? <div className={styles.sourceList}>{occupancy.map((session) => { const occupied = session.confirmed + session.active_holds; return <div className={styles.sourceRow} key={session.session_id}><div><strong>{session.course_title}</strong><span>{occupied} of {session.capacity} places · {dateTime(session.start_at)}</span></div><div className={styles.sourceBar}><span style={{ width: `${Math.max(2, Math.min(100, Math.round((occupied / Math.max(1, session.capacity)) * 100)))}%` }} /></div></div>; })}</div> : <EmptyState title="No upcoming sessions" description="Occupancy appears after a session is scheduled." />}
            </Panel>
            <Panel>
              <PanelHeader kicker="Acquisition" title="UTM sources" />
              {utmSources.length ? <div className={styles.sourceList}>{utmSources.map((source) => <div className={styles.sourceRow} key={source.source}><div><strong>{source.source}</strong><span>{source.visits} visits</span></div><div className={styles.sourceBar}><span style={{ width: `${Math.max(5, Math.round((source.visits / Math.max(1, utmSources[0]?.visits ?? 1)) * 100))}%` }} /></div></div>)}</div> : <EmptyState title="No campaign sources yet" description="UTM-tagged visits will appear here without third-party cookies." />}
            </Panel>
          </div>
        </>
      ) : error ? null : <EmptyState title="No analytics yet" description="First-party events will appear after the site starts receiving visits." />}
    </section>
  );
}

function TeamSection({ members, invitations, error, busy, viewerEmail, referenceTime, onInvite, onMutate }: { members: StaffMemberRecord[]; invitations: StaffInvitationRecord[]; error?: string; busy: string | null; viewerEmail: string; referenceTime: number; onInvite: (email: string, role: "admin" | "analyst") => Promise<boolean>; onMutate: Mutate }) {
  return <section className={styles.section} id="team"><SectionHeader eyebrow="Owner access" title="Team & invitations" description="Invite verified email addresses, review acceptance and keep permissions deliberate." /><SectionError message={error} /><div className={styles.teamGrid}><Panel><PanelHeader kicker={`${members.length} member${members.length === 1 ? "" : "s"}`} title="People with access" />{members.length ? <div className={styles.memberList}>{members.map((member) => <div className={styles.member} key={member.id}><span className={styles.memberAvatar} aria-hidden="true">{member.email.charAt(0).toUpperCase()}</span><span><strong>{member.email}</strong><small>Active since {dateOnly(member.activated_at)}</small></span>{member.email.toLowerCase() === viewerEmail.toLowerCase() ? <span className={styles.memberRole}><strong>{statusFor(member.role).label}</strong><small>{statusFor(member.status).label} · Current account</small></span> : <MemberControl member={member} busy={busy === `member-${member.id}`} onSave={(role, status) => onMutate(`member-${member.id}`, "staff_update", { staff_member_id: member.id, role, status }, "Team access updated.")} />}</div>)}</div> : error ? null : <EmptyState title="No team members returned" description="The verified owner should appear after the backend is initialized." />}</Panel><Panel className={styles.invitePanel}><InviteForm busy={busy === "invite"} onInvite={onInvite} />{invitations.length ? <div className={styles.invitationList}>{invitations.map((invite) => { const expired = !invite.accepted_at && !invite.revoked_at && new Date(invite.expires_at).getTime() <= referenceTime; return <div key={invite.id}><span><strong>{invite.email}</strong><small>{statusFor(invite.role).label} · expires {dateTime(invite.expires_at)}</small></span>{invite.accepted_at ? <StatusBadge status={statusFor("accepted")} /> : invite.revoked_at ? <StatusBadge status={statusFor("revoked")} /> : expired ? <StatusBadge status={statusFor("expired")} /> : <button type="button" disabled={busy === `invite-${invite.id}`} onClick={() => void onMutate(`invite-${invite.id}`, "staff_invite_revoke", { invite_id: invite.id }, "Invitation revoked.")}>{busy === `invite-${invite.id}` ? "Revoking…" : "Revoke"}</button>}</div>; })}</div> : <EmptyState title="No pending invitations" description="New seven-day invitations will appear here." />}</Panel></div></section>;
}

function InviteForm({ busy, onInvite }: { busy: boolean; onInvite: (email: string, role: "admin" | "analyst") => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const email = String(values.get("email") ?? "").trim(); const role = String(values.get("role")) as "admin" | "analyst"; if (await onInvite(email, role)) form.reset(); }
  return <><p className={styles.panelKicker}>Invite someone</p><h3>Add a team member</h3><p>They receive a single-use link that expires after seven days and must accept while signed in with the invited verified email.</p><form className={styles.inviteForm} onSubmit={(event) => void submit(event)}><label>Work email<input name="email" type="email" required autoComplete="email" /></label><label>Role<select name="role" defaultValue="analyst"><option value="analyst">Analyst · Analytics only</option><option value="admin">Admin · Workshops and bookings</option></select></label><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button></form></>;
}

function MemberControl({ member, busy, onSave }: { member: StaffMemberRecord; busy: boolean; onSave: (role: StaffRole, status: string) => Promise<boolean> }) {
  const [role, setRole] = useState<StaffRole>(member.role); const [status, setStatus] = useState(member.status);
  return <div className={styles.memberControls}><select aria-label={`Role for ${member.email}`} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="analyst">Analyst</option></select><select aria-label={`Status for ${member.email}`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="removed">Removed</option></select><button type="button" disabled={busy || (role === member.role && status === member.status)} onClick={() => void onSave(role, status)}>{busy ? "Saving…" : "Save"}</button></div>;
}

function AuditSection({ events, error }: { events: AuditRecord[]; error?: string }) {
  return <section className={styles.section} id="audit"><SectionHeader eyebrow="Owner access" title="Audit log" description="Security and operational changes recorded by the backend." /><SectionError message={error} /><Panel>{events.length ? <div className={styles.auditList}>{events.map((event, index) => <div className={styles.auditItem} key={event.id}><span className={styles.auditLine} aria-hidden="true"><span>{index + 1}</span></span><div><strong>{event.action.replaceAll(/[._]/g, " ")}</strong><p>{event.target_type}{event.target_id ? ` · ${event.target_id}` : ""}</p></div><span className={styles.auditMeta}><strong>{event.actor_email || event.actor_user_id || "System"}</strong><time dateTime={event.occurred_at}>{dateTime(event.occurred_at)}</time></span></div>)}</div> : error ? null : <EmptyState title="No audit events" description="Important owner and automation actions will appear here." />}</Panel></section>;
}

function IntegrationsSection({ integrations, googleConnections, error, busy, canConnect, onConnectGoogle }: { integrations: IntegrationRecord[]; googleConnections: GoogleConnectionRecord[]; error?: string; busy: string | null; canConnect: boolean; onConnectGoogle: () => void }) {
  const google = googleConnections[0];
  const cards = useMemo(() => {
    const mapped = integrations.map((integration) => ({ name: integration.integration.replaceAll("_", " "), status: integration.status, detail: integration.last_error || (integration.last_success_at ? `Last successful ${dateTime(integration.last_success_at)}` : "No successful run recorded"), failures: integration.consecutive_failures }));
    if (google) mapped.push({ name: "Google Workspace account", status: google.status, detail: `${google.connected_email} · updated ${dateTime(google.updated_at)}`, failures: 0 });
    return mapped;
  }, [google, integrations]);
  return <section className={styles.section} id="integrations"><SectionHeader eyebrow={canConnect ? "Owner access" : "Read-only health"} title="Integrations" description="Connection health only—credentials and tokens are never displayed." action={canConnect ? <button className={styles.primaryButton} type="button" disabled={busy === "google-connect"} onClick={onConnectGoogle}>{busy === "google-connect" ? "Opening Google…" : google ? "Reconnect Google" : "Connect Google Workspace"}</button> : undefined} /><SectionError message={error} />{cards.length ? <div className={styles.integrationGrid}>{cards.map((integration) => <Panel className={styles.integrationCard} key={integration.name}><div className={styles.integrationMark} aria-hidden="true">{integration.name.slice(0, 2).toUpperCase()}</div><div className={styles.integrationContent}><div className={styles.integrationHeading}><div><h3>{statusFor(integration.name).label}</h3><p>{integration.failures ? `${integration.failures} consecutive failures` : "Operational status"}</p></div><StatusBadge status={statusFor(integration.status)} /></div><p>{integration.detail}</p></div></Panel>)}</div> : error ? null : <EmptyState title="No integration health recorded" description="Stripe, Gmail and Calendar checks will appear after their first configuration or run." />}<div className={styles.securityNote}><strong>Secrets stay server-side.</strong><p>This page receives account labels, status and timestamps only.</p></div></section>;
}

function AutomationSection({ jobs, counts, failedEmailDeliveries, error, busy, onMutate }: { jobs: AutomationJobRecord[]; counts: Record<string, number>; failedEmailDeliveries: number; error?: string; busy: string | null; onMutate: Mutate }) {
  return <section className={styles.section} id="automation"><SectionHeader eyebrow="Operations" title="Automation queue" description="Monitor retry-safe calendar, email, alert and enrolment work." /><SectionError message={error} /><div className={styles.bookingSummary}><div><span>Pending</span><strong>{counts.pending ?? 0}</strong></div><div><span>Failed</span><strong>{counts.failed ?? 0}</strong></div><div><span>Email deliveries needing attention</span><strong>{failedEmailDeliveries}</strong></div></div><Panel className={styles.tablePanel}>{jobs.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Recent automation jobs</caption><thead><tr><th>Job</th><th>Created</th><th>Attempts</th><th>Available</th><th>Status</th><th>Action</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.job_type.replaceAll("_", " ")}</strong><small>{job.last_error || "No error"}</small>{job.email_delivery_status ? <small>Email: {job.email_delivery_status}</small> : null}</td><td>{dateTime(job.created_at)}</td><td>{job.attempts} / {job.max_attempts}</td><td>{dateTime(job.available_at)}</td><td><StatusBadge status={statusFor(job.status)} /></td><td><AutomationJobAction job={job} busy={busy} onMutate={onMutate} /></td></tr>)}</tbody></table></div> : error ? null : <EmptyState title="No automation jobs" description="Queued enrolment work will appear here." />}</Panel></section>;
}

function AutomationJobAction({ job, busy, onMutate }: { job: AutomationJobRecord; busy: string | null; onMutate: Mutate }) {
  if (job.status === "pending") {
    const busyKey = `job-cancel-${job.id}`;
    return <button className={`${styles.tableButton} ${styles.dangerButton}`} type="button" disabled={busy === busyKey} onClick={() => { if (window.confirm(`Cancel this pending ${job.job_type.replaceAll("_", " ")} job?`)) void onMutate(busyKey, "automation_job_cancel", { job_id: job.id }, "Automation job cancelled."); }}>{busy === busyKey ? "Cancelling…" : "Cancel"}</button>;
  }

  if (job.job_type !== "email" && ["failed", "completed", "cancelled"].includes(job.status)) {
    const busyKey = `job-rerun-${job.id}`;
    return <button className={styles.tableButton} type="button" disabled={busy === busyKey} onClick={() => { if (window.confirm(`Rerun this ${job.job_type.replaceAll("_", " ")} job from the beginning?`)) void onMutate(busyKey, "automation_job_rerun", { job_id: job.id }, "Automation job queued to rerun."); }}>{busy === busyKey ? "Queueing…" : "Rerun"}</button>;
  }

  if (job.status !== "failed") return <>—</>;

  const canConfirmSent = job.email_delivery_status === "uncertain";
  const canRetryUnsent = canConfirmSent || job.email_delivery_status === "failed";
  if (!canRetryUnsent) return <>Review delivery record</>;

  const confirmKey = `email-confirm-${job.id}`;
  const retryKey = `email-retry-${job.id}`;
  return <div className={styles.tableActions}>{canConfirmSent ? <button className={styles.tableButton} type="button" disabled={busy === confirmKey || busy === retryKey} onClick={() => { if (window.confirm("Check the Gmail Sent folder first. Confirm that this exact message was delivered?")) void onMutate(confirmKey, "email_delivery_reconcile", { job_id: job.id, resolution: "confirm_sent" }, "Email delivery marked as sent."); }}>Confirm sent</button> : null}<button className={styles.tableButton} type="button" disabled={busy === confirmKey || busy === retryKey} onClick={() => { if (window.confirm("Check the Gmail Sent folder first. Retry only if this exact message was not delivered. Continue?")) void onMutate(retryKey, "email_delivery_reconcile", { job_id: job.id, resolution: "retry_unsent" }, "Verified-unsent email queued for retry."); }}>{busy === retryKey ? "Retrying…" : "Verified unsent—retry"}</button></div>;
}

function percent(value: number, total: number) { return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%"; }
function capitalize(value: AdminTone): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function amsterdamLocalToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let offset = amsterdamOffset(new Date(localAsUtc));
  let instant = localAsUtc - offset;
  const adjustedOffset = amsterdamOffset(new Date(instant));
  if (adjustedOffset !== offset) { offset = adjustedOffset; instant = localAsUtc - offset; }
  return new Date(instant).toISOString();
}

function toAmsterdamLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function amsterdamOffset(date: Date) {
  const part = new Intl.DateTimeFormat("en", { timeZone: "Europe/Amsterdam", timeZoneName: "longOffset", hour: "2-digit" }).formatToParts(date).find((item) => item.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? "GMT+00:00");
  if (!match) return 0;
  const milliseconds = (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  return match[1] === "-" ? -milliseconds : milliseconds;
}
