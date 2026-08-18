import { ApiError } from "./http.ts";

type RpcResult<T> = Promise<{ data: T | null; error: { message?: string; code?: string; details?: string } | null }>;

export type RpcClient = {
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) => RpcResult<T>;
};

const statusByMessage: Record<string, number> = {
  already_enrolled: 409,
  checkout_attempt_not_attachable: 409,
  invalid_waitlist_offer: 403,
  seats_available: 409,
  session_full: 409,
  session_not_bookable: 409,
  session_not_waitlistable: 409,
  staff_access_required: 403,
  staff_admin_required: 403,
  staff_invite_email_mismatch: 403,
  staff_invite_invalid_or_expired: 410,
  waitlist_offer_expiring: 410,
  waitlist_priority: 409,
  request_rate_limited: 429,
  analytics_rate_limited: 429,
  email_sensitive_payload_expired: 410,
  private_quote_checkout_window_too_short: 409,
};

export async function rpc<T>(
  client: RpcClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.rpc<T>(name, args);
  if (error) {
    const message = error.message?.trim() || "database_operation_failed";
    const status = statusByMessage[message] ?? 400;
    throw new ApiError(message, humanize(message), status, {
      database_code: error.code,
      database_details: error.details,
    });
  }
  if (data === null) {
    throw new ApiError("database_operation_failed", "The database returned no result.", 500);
  }
  return data;
}

function humanize(code: string): string {
  const known: Record<string, string> = {
    already_enrolled: "You already have a seat for this workshop.",
    invalid_waitlist_offer: "This waitlist offer is invalid.",
    seats_available: "A seat is currently available; continue to checkout instead.",
    session_full: "This workshop is currently full.",
    session_not_bookable: "This workshop is not available for booking.",
    session_not_waitlistable: "This workshop is not accepting waitlist entries.",
    staff_access_required: "Staff access is required.",
    staff_admin_required: "Administrator access is required.",
    staff_invite_email_mismatch: "Sign in with the email address that received the invitation.",
    staff_invite_invalid_or_expired: "This staff invitation is invalid or has expired.",
    waitlist_offer_expiring: "This waitlist offer is too close to expiry to start payment.",
    waitlist_priority: "An existing waitlist has priority for the available seat.",
    request_rate_limited: "Too many requests were submitted. Please try again later.",
    analytics_rate_limited: "Too many analytics events were submitted.",
    email_sensitive_payload_expired:
      "This email action has expired. Create a fresh invitation or offer instead.",
    private_quote_checkout_window_too_short:
      "This quote no longer has enough time to start a secure checkout.",
  };
  return known[code] ?? code.replaceAll("_", " ");
}
