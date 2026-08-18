import { withSupabase } from "npm:@supabase/server@1.4.1";
import { sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { env, errorMessage } from "../_shared/http.ts";
import { exchangeGoogleCode, googleUserInfo, persistGoogleConnection } from "../_shared/google.ts";

type OAuthState = {
  actor_user_id: string;
  code_verifier: string;
  redirect_uri: string;
};

function redirect(status: "connected" | "error", detail?: string): Response {
  const url = new URL("/admin", env("PUBLIC_SITE_URL"));
  url.searchParams.set("google", status);
  if (detail) url.searchParams.set("reason", detail.slice(0, 80));
  url.hash = "integrations";
  return Response.redirect(url, 303);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "GET") return redirect("error", "method_not_allowed");
    try {
      const url = new URL(req.url);
      if (url.searchParams.get("error")) {
        return redirect("error", url.searchParams.get("error") ?? "google_denied");
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || state.length > 300) return redirect("error", "invalid_callback");

      const oauthState = await rpc<OAuthState>(ctx.supabaseAdmin, "consume_google_oauth_state", {
        p_state_hash: await sha256Hex(state),
      });
      const tokens = await exchangeGoogleCode(code, oauthState.code_verifier, oauthState.redirect_uri);
      const profile = await googleUserInfo(tokens.access_token);
      const connectedEmail = profile.email?.toLowerCase();
      const requiredEmail = env("GOOGLE_WORKSPACE_EMAIL").toLowerCase();
      const requiredDomain = Deno.env.get("GOOGLE_WORKSPACE_DOMAIN")?.trim().toLowerCase();
      if (
        !connectedEmail || profile.verified_email === false || connectedEmail !== requiredEmail ||
        (requiredDomain && !connectedEmail.endsWith(`@${requiredDomain}`))
      ) {
        return redirect("error", "workspace_email_mismatch");
      }

      await persistGoogleConnection(
        ctx.supabaseAdmin,
        oauthState.actor_user_id,
        connectedEmail,
        tokens,
      );
      return redirect("connected");
    } catch (error) {
      console.error("Google OAuth callback failed", error);
      return redirect("error", errorMessage(error).replaceAll(" ", "_").toLowerCase());
    }
  }),
};
