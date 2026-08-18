"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeReturnPath } from "@/lib/supabase/redirects";

export function AuthCallbackHandler() {
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeSignIn() {
      const client = getSupabaseBrowserClient();
      if (!client) {
        setError("Sign-in is not configured for this site yet.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get("error_description") ?? params.get("error");
      if (oauthError) {
        setError(oauthError);
        return;
      }

      const code = params.get("code");
      const next = safeReturnPath(params.get("next"));

      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      } else {
        const { data } = await client.auth.getSession();
        if (!data.session) {
          setError("This sign-in link is invalid or has expired. Please request a new one.");
          return;
        }
      }

      window.location.replace(next);
    }

    void completeSignIn();
  }, []);

  return (
    <div className="mx-auto max-w-xl rounded-[28px] bg-white p-8 text-center shadow-[var(--shadow)]">
      {error ? (
        <div role="alert">
          <p className="eyebrow">Sign-in needs attention</p>
          <h1 className="text-4xl">We couldn’t complete that link</h1>
          <p className="mt-5">{error}</p>
          <a className="button button-primary mt-5" href="/sign-in">Request a new sign-in link</a>
        </div>
      ) : (
        <>
          <p className="eyebrow">Secure sign-in</p>
          <h1 className="text-4xl">Completing your sign-in…</h1>
          <p className="mb-0 mt-5" role="status">You’ll be redirected in a moment.</p>
        </>
      )}
    </div>
  );
}
