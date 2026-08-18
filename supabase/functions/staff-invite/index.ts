import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { randomToken, sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { ApiError, env, handleError, methodNotAllowed, normalizeEmail, ok, readJson } from "../_shared/http.ts";

type InviteRequest = { email?: unknown; role?: unknown };

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<InviteRequest>(req);
      const email = normalizeEmail(body.email);
      if (typeof body.role !== "string" || !["admin", "analyst"].includes(body.role)) {
        throw new ApiError("invalid_staff_role", "Choose admin or analyst.");
      }
      const token = randomToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      const siteUrl = env("PUBLIC_SITE_URL").replace(/\/$/u, "");
      const inviteUrl = `${siteUrl}/staff/invite?token=${encodeURIComponent(token)}`;
      const result = await rpc(ctx.supabaseAdmin, "create_staff_invite", {
        p_actor_user_id: user.id,
        p_email: email,
        p_role: body.role,
        p_token_hash: await sha256Hex(token),
        p_invite_url: inviteUrl,
        p_expires_at: expiresAt,
      });
      return ok(result, 201);
    } catch (error) {
      return handleError(error);
    }
  }),
};
