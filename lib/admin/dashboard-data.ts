export type StaffRole = "owner" | "admin" | "analyst";
export type AdminTone = "success" | "warning" | "neutral" | "danger" | "info";

export type AdminStatus = {
  label: string;
  tone: AdminTone;
};

export type SessionRecord = {
  id: string;
  course_id: string;
  format: string;
  start_at: string;
  end_at: string;
  timezone: string;
  venue: string | null;
  capacity: number;
  status: string;
  created_at?: string;
  updated_at?: string;
};

export type CourseRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  outcomes: string[];
  level: string;
  audience: string;
  agenda: unknown[];
  duration_minutes: number;
  price_cents: number;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  status: string;
  visibility?: string;
  seo_title: string | null;
  seo_description: string | null;
  sessions: SessionRecord[];
};

export type EnrollmentRecord = {
  id: string;
  session_id: string;
  attendee_email: string;
  attendee_name: string | null;
  status: string;
  amount_cents: number;
  currency: string;
  booked_at: string;
  confirmed_at: string | null;
  refunded_at?: string | null;
  course_title: string;
  start_at: string;
  timezone: string;
};

export type WaitlistRecord = {
  id: string;
  session_id: string;
  email: string;
  full_name: string | null;
  status: string;
  joined_at: string;
  offered_at: string | null;
  offer_expires_at: string | null;
  accepted_at?: string | null;
  position?: number;
  course_title?: string;
  course_slug?: string;
  session_start_at?: string;
  session_timezone?: string;
};

export type QuoteRecord = {
  id: string;
  request_id: string;
  amount_cents: number;
  currency: string;
  vat_inclusive: boolean;
  description: string;
  valid_until: string;
  status: string;
  sent_at: string | null;
  accepted_at?: string | null;
  created_at: string;
};

export type PrivateRequestRecord = {
  id: string;
  contact_name: string;
  email: string;
  organization: string;
  attendee_count: number | null;
  preferred_format: string | null;
  preferred_timing: string | null;
  goals: string;
  status: string;
  created_at: string;
  updated_at: string;
  quotes: QuoteRecord[];
  quote_count?: number;
  quotes_truncated?: boolean;
};

export type AnalyticsSummary = {
  from: string;
  to: string;
  page_views: number;
  course_views: number;
  checkout_starts: number;
  confirmed_enrollments: number;
  revenue_cents: number;
  gross_revenue_cents: number;
  net_revenue_cents: number;
  refund_count: number;
  refunded_cents: number;
  private_requests: number;
  waitlist_joins: number;
  waitlist_offers: number;
  waitlist_acceptances: number;
  automation_failures: number;
  currency: string;
  top_courses: Array<{ course_id: string | null; course_slug: string; course_title: string; views: number }>;
  utm_sources: Array<{ source: string; visits: number }>;
  upcoming_occupancy: Array<{
    session_id: string;
    course_title: string;
    start_at: string;
    capacity: number;
    confirmed: number;
    active_holds: number;
  }>;
};

export type StaffMemberRecord = {
  id: string;
  user_id?: string | null;
  email: string;
  role: StaffRole;
  status: string;
  activated_at: string | null;
  created_at: string;
};

export type StaffInvitationRecord = {
  id: string;
  email: string;
  role: "admin" | "analyst";
  status?: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AuditRecord = {
  id: number | string;
  actor_user_id: string | null;
  actor_email?: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  occurred_at: string;
};

export type IntegrationRecord = {
  integration: string;
  status: string;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type GoogleConnectionRecord = {
  id: string;
  connected_email: string;
  status: string;
  scopes: string[];
  token_expires_at: string;
  updated_at: string;
};

export type AutomationJobRecord = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  last_error: string | null;
  created_at: string;
  completed_at?: string | null;
  email_delivery_status?: string | null;
  requires_reconciliation?: boolean;
};

export function money(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("en-NL", {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(cents) ? cents / 100 : 0);
}

export function dateTime(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function dateOnly(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "medium",
  }).format(date);
}

export function statusFor(value: string): AdminStatus {
  const normalized = value.replaceAll("_", " ");
  const label = normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (["active", "accepted", "completed", "confirmed", "healthy", "paid", "published", "scheduled", "sent", "won"].includes(value)) {
    return { label, tone: "success" };
  }
  if (["failed", "failing", "lost", "revoked", "cancelled"].includes(value)) {
    return { label, tone: "danger" };
  }
  if (["degraded", "offered", "pending", "pending_payment", "quoted", "retrying", "sold_out", "waiting"].includes(value)) {
    return { label, tone: "warning" };
  }
  if (["contacted", "qualified", "new"].includes(value)) {
    return { label, tone: "info" };
  }
  return { label, tone: "neutral" };
}

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "admin" || value === "analyst";
}

export function recordArray<T>(value: unknown, key: string): T[] {
  if (typeof value !== "object" || value === null) return [];
  const entry = (value as Record<string, unknown>)[key];
  return Array.isArray(entry) ? entry as T[] : [];
}
