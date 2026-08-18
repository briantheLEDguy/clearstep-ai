import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { resolveWorkshopSession } from "../_shared/catalog.ts";
import { rpc } from "../_shared/db.ts";
import { handleError, methodNotAllowed, ok, readJson } from "../_shared/http.ts";

type WaitlistRequest = { workshopSlug?: unknown; sessionRef?: unknown };

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const user = requireUser(ctx.userClaims);
      const body = await readJson<WaitlistRequest>(req);
      const sessionId = await resolveWorkshopSession(
        ctx.supabaseAdmin,
        body.workshopSlug,
        body.sessionRef,
      );
      const profile = await ctx.supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const result = await rpc(ctx.supabaseAdmin, "join_session_waitlist", {
        p_session_id: sessionId,
        p_user_id: user.id,
        p_email: user.email,
        p_full_name: profile.data?.full_name ?? null,
      });
      return ok(result, 201);
    } catch (error) {
      return handleError(error);
    }
  }),
};
