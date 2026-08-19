"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";

type EnrollmentOption = { id: string; label: string };
type CustomerRequestKind = "access" | "correction" | "erasure" | "restriction" | "objection" | "cancellation";
type CustomerRequest = {
  id: string;
  kind: CustomerRequestKind;
  status: string;
  enrollment_id: string | null;
  created_at: string;
  updated_at: string;
};

const dataRequestLabels: Record<Exclude<CustomerRequestKind, "cancellation">, string> = {
  access: "Ask for access to my personal data",
  correction: "Ask us to correct my personal data",
  erasure: "Ask us to erase personal data",
  restriction: "Ask us to restrict processing",
  objection: "Object to a use of my personal data",
};

function requestLabel(kind: CustomerRequestKind) {
  return kind === "cancellation" ? "Cancellation or booking-change request" : dataRequestLabels[kind];
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

/**
 * A narrow authenticated intake centre. It deliberately records a request for
 * human review; it never promises an automated refund, export, or deletion.
 */
export function CustomerRequestsPanel({ enrollments }: { enrollments: EnrollmentOption[] }) {
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [kind, setKind] = useState<CustomerRequestKind>("access");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadRequests = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setLoading(false);
      return;
    }
    const { data, error } = await client.functions.invoke("customer-requests", { body: { action: "list" } });
    if (error) {
      setMessage(await functionErrorMessage(error, "We couldn’t load your requests right now."));
      setLoading(false);
      return;
    }
    const result = unwrapFunctionData<{ requests?: unknown }>(data);
    setRequests(Array.isArray(result?.requests) ? result.requests as CustomerRequest[] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Defer the initial network read until after the first paint. This avoids
    // synchronously cascading state updates during hydration.
    const timer = window.setTimeout(() => {
      void loadRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const details = String(formData.get("details") ?? "").trim();
    const enrollmentId = String(formData.get("enrollmentId") ?? "");
    if (kind === "cancellation" && !enrollmentId) {
      setMessage("Choose the booking you want us to review.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const body = kind === "cancellation"
      ? { action: "create_cancellation_request", enrollmentId, details }
      : { action: "create_data_request", kind, details };
    const { error } = await client.functions.invoke("customer-requests", { body });
    if (error) {
      setMessage(await functionErrorMessage(error, "We couldn’t submit that request. Please try again."));
      setSubmitting(false);
      return;
    }
    form.reset();
    setMessage("Your request has been recorded for staff review. We’ll contact you through your account email.");
    setSubmitting(false);
    await loadRequests();
  }

  return (
    <section className="mt-9 border-t border-[var(--border)] pt-8" aria-labelledby="privacy-requests-title">
      <p className="eyebrow">Privacy and booking support</p>
      <h3 id="privacy-requests-title" className="text-2xl">Requests and cancellations</h3>
      <p className="text-sm text-[color:rgba(16,42,67,.72)]">Submit an authenticated request for staff review. A request does not automatically change a booking, payment, or data record.</p>

      <form className="mt-5 grid gap-4 rounded-2xl bg-[var(--cream)] p-5" onSubmit={submit} aria-busy={submitting}>
        <div>
          <label className="mb-2 block font-bold" htmlFor="customer-request-kind">What do you need?</label>
          <select className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-white px-3" id="customer-request-kind" value={kind} onChange={(event) => setKind(event.target.value as CustomerRequestKind)}>
            {Object.entries(dataRequestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="cancellation">Cancellation or booking-change request</option>
          </select>
        </div>
        {kind === "cancellation" ? (
          <div>
            <label className="mb-2 block font-bold" htmlFor="customer-request-enrollment">Booking to review</label>
            <select className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-white px-3" id="customer-request-enrollment" name="enrollmentId" required>
              <option value="">Choose a booking</option>
              {enrollments.map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{enrollment.label}</option>)}
            </select>
          </div>
        ) : null}
        <div>
          <label className="mb-2 block font-bold" htmlFor="customer-request-details">Helpful context <span className="font-normal">(optional)</span></label>
          <textarea className="w-full rounded-xl border border-[var(--border)] bg-white p-3" id="customer-request-details" name="details" rows={3} maxLength={1000} />
          <p className="mb-0 mt-1 text-xs text-[color:rgba(16,42,67,.68)]">Do not include passwords, payment card details, health information, or other sensitive data.</p>
        </div>
        <button className="button button-primary justify-self-start border-0 disabled:opacity-60" type="submit" disabled={submitting || (kind === "cancellation" && !enrollments.length)}>{submitting ? "Submitting…" : "Submit for review"}</button>
      </form>

      {message ? <p className="mt-4 rounded-xl bg-[var(--mint)] p-3 text-sm" role="status" aria-live="polite">{message}</p> : null}
      <div className="mt-6" aria-live="polite">
        <h4 className="text-lg">Your submitted requests</h4>
        {loading ? <p>Loading requests…</p> : requests.length ? (
          <ul className="grid gap-2 p-0" aria-label="Submitted requests">
            {requests.map((request) => (
              <li className="list-none rounded-xl border border-[var(--border)] p-3" key={request.id}>
                <strong>{requestLabel(request.kind)}</strong><br />
                <span className="text-sm">Status: {statusLabel(request.status)} · Submitted {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(request.created_at))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[color:rgba(16,42,67,.72)]">No requests submitted.</p>}
      </div>
    </section>
  );
}
