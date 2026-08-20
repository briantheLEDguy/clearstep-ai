"use client";

import { type FormEvent, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { callbackUrl, safeReturnPath } from "@/lib/supabase/redirects";

type SignInStatus = "idle" | "opening-google" | "sending-email" | "sent" | "error";

const GOOGLE_REDIRECT_FEEDBACK_MS = 300;

function readableAuthError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function safeOAuthUrl(value: string) {
  const url = new URL(value);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Google sign-in returned an invalid redirect. Please try again.");
  }
  return url.toString();
}

export function SignInForm({ nextPath = "/account" }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [message, setMessage] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const submitting = useRef(false);
  const safeNext = safeReturnPath(nextPath);
  const busy = status === "opening-google" || status === "sending-email";

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("error");
      setMessage("Sign-in is not configured yet. Please contact Brian for access.");
      return;
    }

    submitting.current = true;
    setStatus("sending-email");
    setMessage("");
    setOauthUrl("");

    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callbackUrl(safeNext),
          shouldCreateUser: true,
        },
      });

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      setStatus("sent");
      setMessage("Check your inbox for a secure sign-in link. You can close this page after it arrives.");
    } catch (error) {
      setStatus("error");
      setMessage(readableAuthError(error, "We couldn’t send a sign-in link. Please try again."));
    } finally {
      submitting.current = false;
    }
  }

  async function signInWithGoogle() {
    if (submitting.current) return;

    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("error");
      setMessage("Google sign-in is not configured yet. Please contact Brian for access.");
      return;
    }

    submitting.current = true;
    setStatus("opening-google");
    setMessage("Preparing a secure hand-off to Google. You’ll return here automatically.");
    setOauthUrl("");

    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl(safeNext),
          scopes: "openid email profile",
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        setStatus("error");
        setMessage(error.message);
        submitting.current = false;
        return;
      }

      if (!data.url) throw new Error("Google sign-in did not return a redirect. Please try again.");

      const redirect = safeOAuthUrl(data.url);
      setOauthUrl(redirect);
      setMessage("Opening Google now. If nothing happens, use the Continue to Google link below.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, GOOGLE_REDIRECT_FEEDBACK_MS));
      window.location.assign(redirect);
    } catch (error) {
      setStatus("error");
      setMessage(readableAuthError(error, "We couldn’t open Google sign-in. Please try again."));
      submitting.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-[30px] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow)] md:p-10">
      <button
        className="button w-full cursor-pointer border border-[var(--border)] bg-white text-[var(--navy)]"
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
      >
        {status === "opening-google" ? "Opening Google…" : "Continue with Google"}
      </button>
      <div className="my-7 flex items-center gap-4 text-sm font-semibold text-[color:rgba(16,42,67,.58)]" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--border)]" /> or use email <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <form onSubmit={sendMagicLink}>
        <label className="mb-2 block font-bold" htmlFor="email">Email address</label>
        <input
          className="min-h-13 w-full rounded-2xl border border-[var(--border)] bg-[var(--cream)] px-4 text-[var(--navy)] outline-none focus:border-[var(--action)] focus:ring-3 focus:ring-[var(--mint)]"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
        />
        <button className="button button-primary mt-5 w-full cursor-pointer border-0" type="submit" disabled={busy || status === "sent"}>
          {status === "sending-email" ? "Sending secure link…" : "Email me a sign-in link"}
        </button>
      </form>
      {message ? (
        <p
          className={`mb-0 mt-5 rounded-2xl p-4 text-sm ${status === "error" ? "bg-[#fff0ec] text-[#8f2f1f]" : "bg-[var(--mint)] text-[var(--navy)]"}`}
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      {oauthUrl ? (
        <a className="text-link mt-4 inline-block" href={oauthUrl}>Continue to Google →</a>
      ) : null}
      <p className="mb-0 mt-6 text-sm text-[color:rgba(16,42,67,.68)]">
        No password to remember. By continuing, you agree to our <a className="font-bold underline" href="/terms">terms</a> and acknowledge our <a className="font-bold underline" href="/privacy">privacy policy</a>.
      </p>
    </div>
  );
}
