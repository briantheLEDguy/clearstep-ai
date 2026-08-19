"use client";

import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { CustomerRequestsPanel } from "@/components/customer-requests-panel";

type Enrollment = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  bookedAt: string;
  confirmedAt: string | null;
  course: { slug: string; title: string; summary: string };
  session: {
    id: string;
    format: string;
    startAt: string;
    endAt: string;
    timezone: string;
    venue: string | null;
    status: string;
    googleEventId: string | null;
    meetUrl: string | null;
  };
  payment: {
    status: string;
    amountCents: number;
    amountRefundedCents: number;
    paidAt: string | null;
    refundedAt: string | null;
  } | null;
};

function enrollmentRows(value: unknown): Enrollment[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { enrollments?: unknown }).enrollments;
  return Array.isArray(rows) ? rows as Enrollment[] : [];
}

function safeMeetUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function AccountDashboard() {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(configured);
  const [notice, setNotice] = useState(configured ? "" : "Account access is being connected. Please check back soon or contact Brian.");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;

    let active = true;

    async function loadAccount() {
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      setUser(userData.user);

      if (userData.user) {
        const { data, error } = await supabase.rpc("my_enrollment_details");

        if (!active) return;
        if (error) {
          setNotice("We couldn’t load your workshops right now. Your confirmed booking is still safe.");
        } else {
          setEnrollments(enrollmentRows(data));
        }
      }

      setLoading(false);
    }

    void loadAccount();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const client = getSupabaseBrowserClient();
    await client?.auth.signOut();
    window.location.replace("/");
  }

  if (loading) {
    return <p className="rounded-3xl bg-white p-8 shadow-[var(--shadow)]" role="status">Loading your account…</p>;
  }

  if (!user) {
    return (
      <div className="rounded-[28px] bg-white p-8 shadow-[var(--shadow)]">
        <h2 className="text-3xl">Sign in to see your workshops</h2>
        <p className="mt-4">Your bookings, joining details, and account information live here.</p>
        {notice ? <p className="rounded-2xl bg-[#fff0ec] p-4 text-sm text-[#8f2f1f]">{notice}</p> : null}
        <a className="button button-primary mt-3" href="/sign-in?next=%2Faccount">Sign in</a>
      </div>
    );
  }

  return (
    <div className="grid gap-7 lg:grid-cols-[1fr_320px]">
      <section className="rounded-[28px] bg-white p-7 shadow-[var(--shadow)] md:p-9" aria-labelledby="your-workshops">
        <p className="eyebrow">Your learning</p>
        <h2 id="your-workshops" className="text-4xl">Your workshops</h2>
        {notice ? <p className="mt-5 rounded-2xl bg-[#fff0ec] p-4 text-sm text-[#8f2f1f]" role="status">{notice}</p> : null}
        {enrollments.length ? (
          <div className="mt-7 grid gap-4">
            {enrollments.map((enrollment) => (
              <article className="rounded-2xl border border-[var(--border)] bg-[var(--cream)] p-5" key={enrollment.id}>
                <p className="m-0 font-[var(--font-manrope)] text-xl font-bold">
                  {enrollment.course?.title ?? "Confirmed workshop booking"}
                </p>
                {enrollment.session?.startAt ? (
                  <p className="mb-0 mt-2 text-sm">
                    {new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Amsterdam" }).format(new Date(enrollment.session.startAt))}
                    {enrollment.session.venue ? ` · ${enrollment.session.venue}` : enrollment.session.format === "online" ? " · Live online" : ""}
                  </p>
                ) : null}
                <p className="mb-0 mt-2 text-sm">Status: <strong>{enrollment.status}</strong></p>
                <p className="mb-0 mt-1 text-sm">
                  Payment: <strong>{enrollment.payment?.status ?? "processing"}</strong>
                  {Number.isFinite(enrollment.amountCents)
                    ? ` · ${new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(enrollment.amountCents / 100)}`
                    : ""}
                </p>
                {enrollment.payment && enrollment.payment.amountRefundedCents > 0 ? (
                  <p className="mb-0 mt-1 text-sm">
                    Refunded: <strong>{new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(enrollment.payment.amountRefundedCents / 100)}</strong>
                  </p>
                ) : null}
                {safeMeetUrl(enrollment.session?.meetUrl) ? (
                  <a className="text-link mt-4 inline-block" href={safeMeetUrl(enrollment.session.meetUrl)!} target="_blank" rel="noreferrer">
                    Join Google Meet →
                  </a>
                ) : enrollment.status === "confirmed" && enrollment.session?.googleEventId ? (
                  <p className="mb-0 mt-3 text-sm">Your calendar invitation has been sent to your account email.</p>
                ) : null}
                <p className="mb-0 mt-1 text-sm text-[color:rgba(16,42,67,.68)]">Reference {enrollment.id.slice(0, 8).toUpperCase()}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-7 rounded-2xl bg-[var(--mint)] p-6">
            <p className="m-0 font-bold">No workshops booked yet.</p>
            <p className="mb-0 mt-2">Choose a practical session and your joining details will appear here after payment.</p>
            <Link className="text-link mt-4 inline-block" href="/workshops">Explore workshops →</Link>
          </div>
        )}
        <CustomerRequestsPanel
          enrollments={enrollments.map((enrollment) => ({
            id: enrollment.id,
            label: enrollment.course?.title ?? `Workshop ${enrollment.id.slice(0, 8).toUpperCase()}`,
          }))}
        />
      </section>
      <aside className="rounded-[28px] bg-[var(--navy)] p-7 text-[var(--cream)]" aria-label="Account details">
        <p className="eyebrow text-[var(--mint)]!">Account</p>
        <p className="break-words font-bold">{user.email}</p>
        <p className="text-sm text-white/70">Sign-in and booking updates are sent to this address.</p>
        <button className="button mt-4 w-full cursor-pointer border border-white/35 bg-transparent text-white" type="button" onClick={signOut}>Sign out</button>
      </aside>
    </div>
  );
}
