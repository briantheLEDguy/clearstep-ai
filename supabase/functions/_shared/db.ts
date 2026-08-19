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
  staff_owner_required: 403,
  staff_invite_email_mismatch: 403,
  staff_invite_invalid_or_expired: 410,
  waitlist_offer_expiring: 410,
  waitlist_priority: 409,
  request_rate_limited: 429,
  analytics_rate_limited: 429,
  email_sensitive_payload_expired: 410,
  private_quote_checkout_window_too_short: 409,
  course_not_found: 404,
  course_stripe_product_required: 409,
  course_price_changed: 409,
  automation_job_not_cancellable: 409,
  automation_job_not_rerunnable: 409,
  automation_queue_archive_failed: 500,
  legal_documents_invalid: 400,
  checkout_not_found: 404,
  invalid_customer_request: 400,
  customer_request_enrollment_not_found: 404,
  customer_request_service_order_not_found: 404,
  customer_request_already_open: 409,
  invalid_customer_request_update: 400,
  customer_request_not_found: 404,
  staff_page_limit_invalid: 400,
  staff_page_cursor_invalid: 400,
  staff_page_resource_invalid: 400,
  private_request_required: 400,
  private_request_quotes_page_limit_invalid: 400,
  private_request_quotes_page_cursor_invalid: 400,
  invalid_service_checkout: 400,
  service_not_available: 404,
  service_stripe_price_not_configured: 409,
  service_checkout_target_invalid: 409,
  invalid_service_checkout_attachment: 400,
  service_checkout_not_attachable: 409,
  invalid_service_offering: 400,
  service_line_not_available: 409,
  service_offering_not_found: 404,
  service_price_invalid: 400,
  service_stripe_product_required: 409,
  service_price_changed: 409,
  service_orders_limit_invalid: 400,
  invalid_service_analytics_range: 400,
  service_fulfillment_status_invalid: 400,
  service_fulfillment_transition_invalid: 409,
  service_order_not_found: 404,
  service_order_not_paid: 409,
  service_orders_access_denied: 403,
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
    staff_owner_required: "Owner access is required.",
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
    course_not_found: "The course could not be found.",
    course_stripe_product_required: "Connect a Stripe Product before changing this course price.",
    course_price_changed: "This course price changed in another request. Refresh and try again.",
    automation_job_not_cancellable: "Only pending automation jobs can be cancelled.",
    automation_job_not_rerunnable: "Only terminal non-email jobs can be rerun.",
    automation_queue_archive_failed: "The queue message could not be archived safely.",
    legal_documents_invalid: "The current legal documents could not be recorded. Please try again.",
    checkout_not_found: "The checkout could not be found. Please start again.",
    invalid_customer_request: "Please check the request details and try again.",
    customer_request_enrollment_not_found: "That booking could not be found in your account.",
    customer_request_service_order_not_found: "That service order could not be found in your account.",
    customer_request_already_open: "You already have a similar request awaiting review.",
    invalid_customer_request_update: "Please check the request update and try again.",
    customer_request_not_found: "That customer request could not be found.",
    staff_page_limit_invalid: "Choose a page size between 1 and 100.",
    staff_page_cursor_invalid: "The requested staff page cursor is invalid.",
    staff_page_resource_invalid: "That staff resource cannot be paged.",
    private_request_required: "Choose a private workshop request first.",
    private_request_quotes_page_limit_invalid: "Choose a quote page size between 1 and 100.",
    private_request_quotes_page_cursor_invalid: "The requested quote-history cursor is invalid.",
    invalid_service_checkout: "Choose a valid service offering.",
    service_not_available: "That service offering is not available.",
    service_stripe_price_not_configured: "That service offering is not ready for payment.",
    service_checkout_target_invalid: "That service checkout target is invalid.",
    invalid_service_checkout_attachment: "That service checkout could not be attached.",
    service_checkout_not_attachable: "That service checkout can no longer be attached.",
    invalid_service_offering: "Check the service offering details and try again.",
    service_line_not_available: "That service line is not available.",
    service_offering_not_found: "The service offering could not be found.",
    service_price_invalid: "Choose a valid service price.",
    service_stripe_product_required: "Connect a Stripe Product before changing this service price.",
    service_price_changed: "This service price changed in another request. Refresh and try again.",
    service_orders_limit_invalid: "Choose an order limit between 1 and 300.",
    invalid_service_analytics_range: "Choose a valid service analytics date range.",
    service_fulfillment_status_invalid: "Choose a valid fulfillment status.",
    service_fulfillment_transition_invalid: "That fulfillment status change is not allowed.",
    service_order_not_found: "The service order could not be found.",
    service_order_not_paid: "Only a paid service order can move into fulfillment.",
    service_orders_access_denied: "You cannot access those service orders.",
  };
  return known[code] ?? code.replaceAll("_", " ");
}
