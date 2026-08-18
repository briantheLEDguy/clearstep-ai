import { withSupabase } from "npm:@supabase/server@1.4.1";
import { requireUser } from "../_shared/auth.ts";
import { randomToken, sha256Base64Url, sha256Hex } from "../_shared/crypto.ts";
import { rpc } from "../_shared/db.ts";
import { env, handleError, methodNotAllowed, ok } from "../_shared/http.ts";
import { GOOGLE_SCOPES } from "../_shared/google.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const user = requireUser(ctx.userClaims);
      const state = randomToken();
      const codeVerifier = randomToken(64);
      const redirectUri = env("GOOGLE_OAUTH_REDIRECT_URI");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();

      await rpc(ctx.supabaseAdmin, "create_google_oauth_state", {
        p_actor_user_id: user.id,
        p_state_hash: await sha256Hex(state),
        p_code_verifier: codeVerifier,
        p_redirect_uri: redirectUri,
        p_expires_at: expiresAt,
      });

      const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizationUrl.search = new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        state,
        code_challenge: await sha256Base64Url(codeVerifier),
        code_challenge_method: "S256",
      }).toString();

      return ok({ authorizationUrl: authorizationUrl.toString(), expiresAt });
    } catch (error) {
      return handleError(error);
    }
  }),
};
