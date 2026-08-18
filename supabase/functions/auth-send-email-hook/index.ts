import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import { authEmails, type AuthHookPayload } from "../_shared/email.ts";
import { ApiError, env, errorMessage, methodNotAllowed } from "../_shared/http.ts";
import { sendGoogleEmail } from "../_shared/google.ts";

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();

    try {
      const rawBody = await req.text();
      const secret = env("SEND_EMAIL_HOOK_SECRET").replace("v1,whsec_", "");
      const payload = new Webhook(secret).verify(
        rawBody,
        Object.fromEntries(req.headers),
      ) as AuthHookPayload;

      for (const message of authEmails(payload)) {
        await sendGoogleEmail(ctx.supabaseAdmin, message);
      }

      // Supabase Auth expects an empty JSON object for a successful Send Email Hook.
      return Response.json({}, { status: 200 });
    } catch (error) {
      console.error("Auth Send Email Hook failed", error);
      const apiError = error instanceof ApiError ? error : null;
      return Response.json({
        error: {
          http_code: apiError?.status ?? 401,
          message: errorMessage(error),
        },
      }, { status: apiError?.status ?? 401 });
    }
  }),
};
