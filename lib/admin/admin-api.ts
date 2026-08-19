import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionApiError, functionErrorDetails, unwrapFunctionData } from "@/lib/supabase/functions";

export type AdminAction =
  | "catalog_list"
  | "course_upsert"
  | "course_price_update"
  | "session_upsert"
  | "private_requests_list"
  | "private_request_quotes_page"
  | "private_request_update"
  | "quote_create"
  | "quote_send"
  | "dashboard_overview"
  | "staff_list_page"
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
  | "automation_job_cancel"
  | "automation_job_rerun"
  | "email_delivery_reconcile"
  | "customer_requests_list"
  | "customer_request_update"
  | "retention_review_status";

export class AdminApiError extends FunctionApiError {
  constructor(message: string, code = "admin_request_failed") {
    super(message, code);
    this.name = "AdminApiError";
  }
}

function unwrapEnvelope<T>(value: unknown): T {
  try {
    return unwrapFunctionData<T>(value) as T;
  } catch (error) {
    if (error instanceof FunctionApiError) {
      throw new AdminApiError(error.message, error.code);
    }
    throw error;
  }
}

async function functionError(error: unknown): Promise<AdminApiError> {
  const fallback = "The staff request could not be completed.";
  const details = await functionErrorDetails(error, fallback, "admin_request_failed");
  return new AdminApiError(details.message, details.code);
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
