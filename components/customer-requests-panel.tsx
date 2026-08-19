"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { functionErrorMessage, unwrapFunctionData } from "@/lib/supabase/functions";

type EnrollmentOption = { id: string; label: string };
type ServiceOrderOption = { id: string; label: string };
type CustomerRequestKind = "access" | "correction" | "erasure" | "restriction" | "objection" | "cancellation" | "change";
type CustomerRequest = {
  id: string;
  kind: CustomerRequestKind;
  status: string;
  enrollment_id: string | null;
  service_order_id: string | null;
  created_at: string;
  updated_at: string;
};

const dataRequestLabels: Record<Exclude<CustomerRequestKind, "cancellation" | "change">, string> = {
  access: "Ask for access to my personal data",
  correction: "Ask us to correct my personal data",
  erasure: "Ask us to erase personal data",
  restriction: "Ask us to restrict processing",
  objection: "Object to a use of my personal data",
};

const purchaseRequestLabels = {
  change: "Ask to change a booking or service order",
  cancellation: "Ask to cancel a booking or service order",
} as const;

function requestLabel(kind: CustomerRequestKind) {
  return kind === "cancellation" || kind === "change" ? purchaseRequestLabels[kind] : dataRequestLabels[kind];
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

/**
 * A narrow authenticated intake centre. It deliberately records a request for
 * human review; it never promises an automated refund, export, or deletion.
 */
export function CustomerRequestsPanel({
  enrollments,
  serviceOrders,
}: {
  enrollments: EnrollmentOption[];
  serviceOrders: ServiceOrderOption[];
}) {
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [kind, setKind] = useState<CustomerRequestKind>("access");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const purchaseTargets = [
    ...enrollments.map((item) => ({ ...item, type: "enrollment" as const })),
    ...serviceOrders.map((item) => ({ ...item, type: "serviceOrder" as const })),
  ];

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
    const purchaseTarget = String(formData.get("purchaseTarget") ?? "");
    const isPurchaseRequest = kind === "cancellation" || kind === "change";
    const [targetType, targetId] = purchaseTarget.split(":", 2);
    if (isPurchaseRequest && (!targetId || (targetType !== "enrollment" && targetType !== "serviceOrder"))) {
      setMessage("Choose the booking or service order you want us to review.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const body = isPurchaseRequest
      ? {
          action: "create_purchase_request",
          kind,
          ...(targetType === "enrollment" ? { enrollmentId: targetId } : { serviceOrderId: targetId }),
          details,
        }
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
    <section className="mt-9 border-t border-[var(--color-border)] pt-8" aria-labelledby="privacy-requests-title">
      <p className="eyebrow">Privacy and booking support</p>
      <h3 id="privacy-requests-title" className="text-2xl">Requests, changes, and cancellations</h3>
      <p className="text-sm text-[color:rgba(16,42,67,.72)]">Submit an authenticated request for staff review. A request does not automatically change a booking, payment, or data record.</p>

      <form className="mt-5 grid gap-4 rounded-2xl bg-[var(--color-surface)] p-5" onSubmit={submit} aria-busy={submitting}>
        <div>
          <label className="mb-2 block font-bold" htmlFor="customer-request-kind">What do you need?</label>
          <select className="min-h-12 w-full rounded-xl border border-[var(--color-border)] bg-white px-3" id="customer-request-kind" value={kind} onChange={(event) => setKind(event.target.value as CustomerRequestKind)}>
            {Object.entries(dataRequestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="change">{purchaseRequestLabels.change}</option>
            <option value="cancellation">{purchaseRequestLabels.cancellation}</option>
          </select>
        </div>
        {kind === "cancellation" || kind === "change" ? (
          <div>
            <label className="mb-2 block font-bold" htmlFor="customer-request-purchase">Booking or service order to review</label>
            <select className="min-h-12 w-full rounded-xl border border-[var(--color-border)] bg-white px-3" id="customer-request-purchase" name="purchaseTarget" required>
              <option value="">Choose a purchase</option>
              {purchaseTargets.map((target) => (
                <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                  {target.type === "enrollment" ? "Workshop" : "Plate & Post"} · {target.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className="mb-2 block font-bold" htmlFor="customer-request-details">Helpful context <span className="font-normal">(optional)</span></label>
          <textarea className="w-full rounded-xl border border-[var(--color-border)] bg-white p-3" id="customer-request-details" name="details" rows={3} maxLength={1000} />
          <p className="mb-0 mt-1 text-xs text-[color:rgba(16,42,67,.68)]">Do not include passwords, payment card details, health information, or other sensitive data.</p>
        </div>
        <button className="button button-primary justify-self-start border-0 disabled:opacity-60" type="submit" disabled={submitting || ((kind === "cancellation" || kind === "change") && !purchaseTargets.length)}>{submitting ? "Submitting…" : "Submit for review"}</button>
      </form>

      {message ? <p className="mt-4 rounded-xl bg-[var(--color-surface-soft)] p-3 text-sm" role="status" aria-live="polite">{message}</p> : null}
      <div className="mt-6" aria-live="polite">
        <h4 className="text-lg">Your submitted requests</h4>
        {loading ? <p>Loading requests…</p> : requests.length ? (
          <ul className="grid gap-2 p-0" aria-label="Submitted requests">
            {requests.map((request) => (
              <li className="list-none rounded-xl border border-[var(--color-border)] p-3" key={request.id}>
                <strong>{requestLabel(request.kind)}</strong><br />
                <span className="text-sm">
                  Status: {statusLabel(request.status)}
                  {request.service_order_id ? " · Plate & Post service order" : request.enrollment_id ? " · Workshop booking" : ""}
                  {` · Submitted ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(request.created_at))}`}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[color:rgba(16,42,67,.72)]">No requests submitted.</p>}
      </div>
    </section>
  );
}
