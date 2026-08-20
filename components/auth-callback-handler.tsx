"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeReturnPath } from "@/lib/supabase/redirects";

type CallbackPhase = "completing" | "slow" | "confirmed" | "error";

const SLOW_SIGN_IN_NOTICE_MS = 6_000;
const CONFIRMATION_DISPLAY_MS = 900;

function callbackErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (/pkce|code verifier/iu.test(message)) {
    return "This sign-in attempt could not be matched to this browser. Please start sign-in again here.";
  }
  if (/fetch|network|timeout|timed out/iu.test(message)) {
    return "We couldn’t reach the sign-in service. Check your connection and start sign-in again.";
  }
  return message || "We couldn’t complete sign-in. Please start again.";
}

export function AuthCallbackHandler() {
  const started = useRef(false);
  const [phase, setPhase] = useState<CallbackPhase>("completing");
  const [error, setError] = useState("");
  const [nextPath, setNextPath] = useState("/account");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function completeSignIn() {
      const params = new URLSearchParams(window.location.search);
      const fragmentParams = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
      const readParam = (name: string) => params.get(name) ?? fragmentParams.get(name);
      const next = safeReturnPath(params.get("next"));
      setNextPath(next);

      let slowNotice: number | undefined;

      try {
        window.history.replaceState(window.history.state, "", window.location.pathname);

        const client = getSupabaseBrowserClient();
        if (!client) {
          setError("Sign-in is not configured for this site yet.");
          setPhase("error");
          return;
        }

        const oauthError = readParam("error_description") ?? readParam("error");
        if (oauthError) {
          setError(oauthError);
          setPhase("error");
          return;
        }

        slowNotice = window.setTimeout(() => setPhase("slow"), SLOW_SIGN_IN_NOTICE_MS);
        const code = readParam("code");
        let session = null;

        if (code) {
          const flowId = readParam("sb_flow_id");
          const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(
            code,
            flowId ? { flowId } : undefined,
          );
          if (exchangeError) throw exchangeError;
          session = data.session;
        } else {
          const { data, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          session = data.session;
        }

        if (!session) {
          setError("This sign-in link is invalid or has expired. Please request a new one.");
          setPhase("error");
          return;
        }

        setPhase("confirmed");
        window.setTimeout(() => window.location.replace(next), CONFIRMATION_DISPLAY_MS);
      } catch (signInError) {
        setError(callbackErrorMessage(signInError));
        setPhase("error");
      } finally {
        if (slowNotice !== undefined) window.clearTimeout(slowNotice);
      }
    }

    void completeSignIn();
  }, []);

  const restartHref = `/sign-in?next=${encodeURIComponent(nextPath)}`;

  return (
    <div
      className="mx-auto max-w-xl rounded-[28px] bg-white p-8 text-center shadow-[var(--shadow)]"
      aria-busy={phase === "completing" || phase === "slow"}
    >
      {phase === "error" ? (
        <div role="alert">
          <p className="eyebrow">Sign-in needs attention</p>
          <h1 className="text-4xl">We couldn’t complete that link</h1>
          <p className="mt-5">{error}</p>
          <a className="button button-primary mt-5" href={restartHref} referrerPolicy="no-referrer">Start sign-in again</a>
        </div>
      ) : phase === "confirmed" ? (
        <div role="status" aria-live="polite">
          <p className="eyebrow">Sign-in complete</p>
          <h1 className="text-4xl">You’re signed in</h1>
          <p className="mb-0 mt-5">Taking you to the next page now…</p>
        </div>
      ) : phase === "slow" ? (
        <>
          <p className="eyebrow">Secure sign-in</p>
          <h1 className="text-4xl">This is taking longer than expected</h1>
          <p className="mt-5" role="status" aria-live="polite">
            We’re still checking your sign-in. Keep this page open, or start again if you do not want to wait.
          </p>
          <a className="button button-primary mt-5" href={restartHref} referrerPolicy="no-referrer">Start sign-in again</a>
        </>
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
