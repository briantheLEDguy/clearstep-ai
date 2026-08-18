import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, handleError, methodNotAllowed, ok, readJson } from "../_shared/http.ts";

type AcceptRequest = { token?: unknown };

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<AcceptRequest>(req);
      if (typeof body.token !== "string" || body.token.length < 32 || body.token.length > 200) {
        throw new ApiError("invalid_staff_invite", "The staff invitation token is invalid.");
      }
      const result = await rpc(ctx.supabaseAdmin, "accept_staff_invite", {
        p_user_id: user.id,
        p_user_email: user.email,
        p_token_hash: await sha256Hex(body.token),
      });
      return ok(result);
    } catch (error) {
      return handleError(error);
    }
  }),
};
