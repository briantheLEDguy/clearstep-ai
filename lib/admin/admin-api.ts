import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminAction =
  | "catalog_list"
  | "course_upsert"
  | "session_upsert"
  | "private_requests_list"
  | "private_request_update"
  | "quote_create"
  | "quote_send"
  | "analytics_summary"
  | "enrollments_list"
  | "google_connection_status"
  | "staff_list"
  | "waitlist_list"
  | "waitlist_offer"
  | "waitlist_remove"
  | "staff_context"
  | "staff_invites_list"
  | "staff_update"
  | "staff_invite_revoke"
  | "audit_list"
  | "operations_status"
  | "automation_jobs_list"
  | "automation_job_retry"
  | "email_delivery_reconcile";

type ApiErrorPayload = {
  code?: unknown;
  message?: unknown;
};

type ApiEnvelope<T> = {
  data?: T | null;
  error?: ApiErrorPayload | null;
};

export class AdminApiError extends Error {
  readonly code: string;

  constructor(message: string, code = "admin_request_failed") {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapEnvelope<T>(value: unknown): T {
  if (!isRecord(value) || !("data" in value || "error" in value)) {
    return value as T;
  }

  const envelope = value as ApiEnvelope<T>;
  if (envelope.error) {
    const message = typeof envelope.error.message === "string"
      ? envelope.error.message
      : "The staff request could not be completed.";
    const code = typeof envelope.error.code === "string"
      ? envelope.error.code
      : "admin_request_failed";
    throw new AdminApiError(message, code);
  }

  return envelope.data as T;
}

async function functionError(error: unknown): Promise<AdminApiError> {
  const fallback = error instanceof Error && error.message
    ? error.message
    : "The staff request could not be completed.";

  if (!isRecord(error)) return new AdminApiError(fallback);
  const context = error.context;
  if (!(context instanceof Response)) return new AdminApiError(fallback);

  try {
    const body = await context.clone().json() as unknown;
    if (!isRecord(body) || !isRecord(body.error)) return new AdminApiError(fallback);
    const message = typeof body.error.message === "string" ? body.error.message : fallback;
    const code = typeof body.error.code === "string" ? body.error.code : "admin_request_failed";
    return new AdminApiError(message, code);
  } catch {
    return new AdminApiError(fallback);
  }
}

export async function invokeAdmin<T>(
  client: SupabaseClient,
  action: AdminAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke("admin-catalog", {
    body: { action, payload },
  });

  if (error) throw await functionError(error);
  return unwrapEnvelope<T>(data);
}

export async function inviteStaff(
  client: SupabaseClient,
  email: string,
  role: "admin" | "analyst",
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("staff-invite", {
    body: { email, role },
  });

  if (error) throw await functionError(error);
  return unwrapEnvelope(data);
}

export async function beginGoogleConnection(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.functions.invoke("google-oauth-start", {
    body: {},
  });

  if (error) throw await functionError(error);
  const result = unwrapEnvelope<{ authorizationUrl?: unknown }>(data);
  if (!result || typeof result.authorizationUrl !== "string") {
    throw new AdminApiError("Google Workspace did not return a connection link.");
  }

  const url = new URL(result.authorizationUrl);
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
    throw new AdminApiError("Google Workspace returned an invalid connection link.");
  }
  return url.toString();
}
