"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";

type InviteResult = {
  email: string;
  role: string;
  status: string;
};

type InviteState = "checking" | "ready" | "signed-out" | "accepting" | "accepted" | "error" | "invalid";

function initialState(token?: string): InviteState {
  if (!token) return "invalid";
  if (!isSupabaseConfigured()) return "error";
  return "checking";
}

export function StaffInviteAcceptance({ token, returnPath }: { token?: string; returnPath: string }) {
  const [state, setState] = useState<InviteState>(() => initialState(token));
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(() => isSupabaseConfigured()
    ? "Checking your sign-in…"
    : "Staff access is being connected. Please ask the Clearstep owner for help.");

  useEffect(() => {
    if (!token) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;
    let active = true;

    async function checkUser() {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;

      if (error || !data.user) {
        setState("signed-out");
        setMessage("Sign in with the verified email address that received this invitation.");
        return;
      }

      setEmail(data.user.email ?? "your signed-in account");
      setState("ready");
      setMessage("Confirm that you want to join the Clearstep staff workspace with this account.");
    }

    void checkUser();
    return () => {
      active = false;
    };
  }, [token]);

  async function acceptInvite() {
    if (!token) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;

    setState("accepting");
    setMessage("Accepting your invitation…");
    const { data, error } = await client.functions.invoke("staff-invite-accept", {
      body: { token },
    });

    if (error) {
      setState("error");
      setMessage(await functionErrorMessage(error, "We couldn’t accept this invitation. It may be expired or linked to a different email."));
      return;
    }

    const result = unwrapFunctionData<InviteResult>(data);
    if (!result || result.status !== "active") {
      setState("error");
      setMessage("The invitation response was incomplete. Please ask the Clearstep owner to check your access.");
      return;
    }

    setState("accepted");
    setMessage(`You now have ${result.role} access as ${result.email}.`);
  }

  const signInHref = `/sign-in?next=${encodeURIComponent(returnPath)}`;

  return (
    <div className="mx-auto max-w-2xl rounded-[30px] border border-[var(--border)] bg-white p-7 shadow-[var(--shadow)] md:p-10">
      {email ? (
        <div className="mb-6 rounded-2xl bg-[var(--mint)] p-5">
          <p className="eyebrow">Signed in as</p>
          <p className="m-0 break-words font-bold">{email}</p>
        </div>
      ) : null}
      <p
        className={`m-0 rounded-2xl p-4 ${state === "error" || state === "invalid" ? "bg-[#fff0ec] text-[#8f2f1f]" : "bg-[var(--cream)]"}`}
        role={state === "error" || state === "invalid" ? "alert" : "status"}
        aria-live="polite"
      >
        {state === "invalid" ? "This staff invitation link is invalid or incomplete." : message}
      </p>
      {state === "signed-out" ? (
        <Link className="button button-primary mt-6 w-full text-center" href={signInHref}>Sign in to accept</Link>
      ) : null}
      {state === "ready" || state === "accepting" ? (
        <button
          className="button button-primary mt-6 w-full cursor-pointer border-0 disabled:cursor-wait disabled:opacity-65"
          type="button"
          disabled={state === "accepting"}
          onClick={acceptInvite}
        >
          {state === "accepting" ? "Accepting invitation…" : "Accept staff invitation"}
        </button>
      ) : null}
      {state === "accepted" ? (
        <Link className="button button-primary mt-6 w-full text-center" href="/admin">Open staff workspace</Link>
      ) : null}
      <p className="mb-0 mt-5 text-sm text-[color:rgba(16,42,67,.68)]">
        Access is granted only when your verified sign-in email matches the invited address.
      </p>
    </div>
  );
}
