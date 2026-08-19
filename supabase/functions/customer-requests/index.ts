import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import {
  ApiError,
  asText,
  handleError,
  methodNotAllowed,
  ok,
  readJson,
  requireUuid,
} from "../_shared/http.ts";

type RequestAction = "list" | "create_data_request" | "create_cancellation_request";
type DataRequestKind = "access" | "correction" | "erasure" | "restriction" | "objection";

type CustomerRequestBody = {
  action?: unknown;
  kind?: unknown;
  enrollmentId?: unknown;
  details?: unknown;
};

const actions = new Set<RequestAction>([
  "list",
  "create_data_request",
  "create_cancellation_request",
]);
const dataRequestKinds = new Set<DataRequestKind>([
  "access",
  "correction",
  "erasure",
  "restriction",
  "objection",
]);

/**
 * This is an intake and status endpoint, not an automated rights decision.
 * The database function owns account/enrollment authorization and writes the
 * staff audit trail before any member of staff can review the request.
 */
export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<CustomerRequestBody>(req, 8_192);
      if (typeof body.action !== "string" || !actions.has(body.action as RequestAction)) {
        throw new ApiError("unsupported_customer_request_action", "That request action is not supported.");
      }

      if (body.action === "list") {
        return ok(await rpc(ctx.supabaseAdmin, "list_my_customer_requests", { p_user_id: user.id }));
      }

      const details = asText(body.details, "details", { max: 1_000, optional: true });
      if (body.action === "create_data_request") {
        if (typeof body.kind !== "string" || !dataRequestKinds.has(body.kind as DataRequestKind)) {
          throw new ApiError("invalid_customer_request_kind", "Choose a supported privacy request type.");
        }
        return ok(await rpc(ctx.supabaseAdmin, "create_customer_request", {
          p_user_id: user.id,
          p_kind: body.kind,
          p_enrollment_id: null,
          p_details: details,
        }), 201);
      }

      return ok(await rpc(ctx.supabaseAdmin, "create_customer_request", {
        p_user_id: user.id,
        p_kind: "cancellation",
        p_enrollment_id: requireUuid(body.enrollmentId, "enrollmentId"),
        p_details: details,
      }), 201);
    } catch (error) {
      return handleError(error);
    }
  }),
};
