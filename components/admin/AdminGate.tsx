"use client";

import { useEffect, useState } from "react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { AdminApiError, invokeAdmin } from "@/lib/admin/admin-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Viewer = { id: string; email: string };
type GateState =
  | { kind: "checking" }
  | { kind: "allowed"; viewer: Viewer }
  | { kind: "signed-out" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "unconfigured" };

export default function AdminGate() {
  const client = getSupabaseBrowserClient();
  const [state, setState] = useState<GateState>(client ? { kind: "checking" } : { kind: "unconfigured" });

  useEffect(() => {
    if (!client) return;
    const supabase = client;

    let active = true;
    async function verifyStaffAccess() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError || !userData.user) {
        setState({ kind: "signed-out" });
        return;
      }

      // Every admin action is role-checked again inside the Edge Function. A
      // read-only summary is the least-privilege way to establish membership.
      const now = new Date();
      const from = new Date(now.getTime() - 60 * 60 * 1000);
      try {
        await invokeAdmin(supabase, "analytics_summary", {
          from: from.toISOString(),
          to: now.toISOString(),
        });
        if (!active) return;
        setState({
          kind: "allowed",
          viewer: {
            id: userData.user.id,
            email: userData.user.email ?? "Staff member",
          },
        });
      } catch (error) {
        if (!active) return;
        if (error instanceof AdminApiError && ["staff_access_required", "staff_membership_inactive"].includes(error.code)) {
          setState({ kind: "forbidden" });
          return;
        }
        setState({
          kind: "unavailable",
          message: error instanceof Error ? error.message : "The staff workspace could not be reached.",
        });
      }
    }

    void verifyStaffAccess();
    return () => {
      active = false;
    };
  }, [client]);

  if (state.kind === "allowed") return <AdminDashboard viewer={state.viewer} />;

  const copy = state.kind === "checking"
    ? "Checking staff access…"
    : state.kind === "signed-out"
      ? "Sign in with your Clearstep staff email to continue."
      : state.kind === "unconfigured"
        ? "The staff workspace is not connected in this environment."
        : state.kind === "unavailable"
          ? state.message
          : "This account does not have access to the Clearstep staff workspace.";

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--cream)] px-5 py-16">
      <section className="w-full max-w-lg rounded-[28px] bg-white p-8 text-center shadow-[var(--shadow)]" aria-live="polite">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mx-auto mb-7 h-auto w-44" src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
        <h1 className="text-3xl">Staff workspace</h1>
        <p className="mt-4">{copy}</p>
        {state.kind === "signed-out" || state.kind === "forbidden" ? (
          <a className="button button-primary mt-4" href="/sign-in?next=%2Fadmin">Sign in</a>
        ) : null}
        {state.kind === "unavailable" ? (
          <button className="button button-primary mt-4" type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        ) : null}
      </section>
    </main>
  );
}
