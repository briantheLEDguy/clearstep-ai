"use client";

import { type FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { callbackUrl, safeReturnPath } from "@/lib/supabase/redirects";

export function SignInForm({ nextPath = "/account" }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const safeNext = safeReturnPath(nextPath);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("error");
      setMessage("Sign-in is not configured yet. Please contact Brian for access.");
      return;
    }

    setStatus("sending");
    setMessage("");
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
  }

  async function signInWithGoogle() {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setStatus("error");
      setMessage("Google sign-in is not configured yet. Please contact Brian for access.");
      return;
    }

    setStatus("sending");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(safeNext),
        scopes: "openid email profile",
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-[30px] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow)] md:p-10">
      <button
        className="button w-full cursor-pointer border border-[var(--border)] bg-white text-[var(--navy)]"
        type="button"
        onClick={signInWithGoogle}
        disabled={status === "sending"}
      >
        Continue with Google
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
        <button className="button button-primary mt-5 w-full cursor-pointer border-0" type="submit" disabled={status === "sending" || status === "sent"}>
          {status === "sending" ? "Sending secure link…" : "Email me a sign-in link"}
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
      <p className="mb-0 mt-6 text-sm text-[color:rgba(16,42,67,.68)]">
        No password to remember. By continuing, you agree to our <a className="font-bold underline" href="/terms">terms</a> and acknowledge our <a className="font-bold underline" href="/privacy">privacy policy</a>.
      </p>
    </div>
  );
}
