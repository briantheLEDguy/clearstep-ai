"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { invokeAdmin } from "@/lib/admin/admin-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import GuidesLibrary from "./GuidesLibrary";
import styles from "./guides.module.css";

type GateState = "checking" | "allowed" | "signed-out" | "locked" | "unconfigured" | "unavailable";

export default function GuidesGate() {
  const client = getSupabaseBrowserClient();
  const [state, setState] = useState<GateState>(client ? "checking" : "unconfigured");

  useEffect(() => {
    if (!client) return;
    const supabase = client;
    let active = true;

    async function checkAccess() {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user) {
        setState("signed-out");
        return;
      }

      const enrollment = await supabase
        .from("enrollments")
        .select("id")
        .eq("status", "confirmed")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (enrollment.data) {
        setState("allowed");
        return;
      }

      try {
        const now = new Date();
        await invokeAdmin(supabase, "analytics_summary", {
          from: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
          to: now.toISOString(),
        });
        if (active) setState("allowed");
      } catch {
        if (!active) return;
        setState(enrollment.error ? "unavailable" : "locked");
      }
    }

    void checkAccess();
    return () => { active = false; };
  }, [client]);

  if (state === "allowed") return <GuidesLibrary />;

  const message = state === "checking"
    ? "Checking your library access…"
    : state === "signed-out"
      ? "Sign in with the account you used to book a workshop."
      : state === "locked"
        ? "Guides unlock after a confirmed workshop booking. Clearstep staff also have access."
        : state === "unconfigured"
          ? "The guide library is not connected in this environment."
          : "We could not check your access. Please try again.";

  return (
    <main className={styles.gate}>
      <section className={styles.gateCard} aria-live="polite">
        <Link href="/" aria-label="Clearstep AI home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
        </Link>
        <p className={styles.kicker}>Member library</p>
        <h1>Guides</h1>
        <p>{message}</p>
        {state === "signed-out" ? <a className={styles.primaryAction} href="/sign-in?next=%2Fguides">Sign in to continue</a> : null}
        {state === "locked" ? <Link className={styles.primaryAction} href="/workshops">Browse workshops</Link> : null}
        {state === "unavailable" ? <button className={styles.primaryAction} type="button" onClick={() => window.location.reload()}>Try again</button> : null}
        <Link className={styles.homeLink} href="/">← Back to Clearstep</Link>
      </section>
    </main>
  );
}
