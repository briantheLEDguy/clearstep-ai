"use client";

import { useEffect, useState } from "react";
import { ServiceCheckout } from "@/components/service-checkout";
import { invokeAdmin } from "@/lib/admin/admin-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PlatePostServiceSlug } from "@/lib/services";

type StaffContext = { role?: unknown };

type DraftService = {
  slug: PlatePostServiceSlug;
  title: string;
  summary: string;
  priceCents: number;
  currency: "EUR";
  visibility: string;
  status: string;
  checkoutConfigured: boolean;
};

type PreviewState =
  | { kind: "hidden" | "checking" }
  | { kind: "missing" | "error" }
  | { kind: "ready"; service: DraftService };

function safeLabel(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : null;
}

function mapDraftService(value: unknown, expectedSlug: PlatePostServiceSlug): DraftService | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= 240 ? item.title.trim() : null;
  const summary = typeof item.summary === "string" && item.summary.trim().length > 0 && item.summary.length <= 1_000 ? item.summary.trim() : null;
  const priceCents = Number.isSafeInteger(item.price_cents) && Number(item.price_cents) > 0 ? Number(item.price_cents) : null;
  const visibility = safeLabel(item.visibility);
  const status = safeLabel(item.status);
  if (
    item.slug !== expectedSlug || item.business_unit !== "plate_and_post" || !title || !summary || !priceCents
    || item.currency !== "EUR" || !visibility || !status
  ) {
    return null;
  }

  return {
    slug: expectedSlug,
    title,
    summary,
    priceCents,
    currency: "EUR",
    visibility,
    status,
    checkoutConfigured: typeof item.stripe_product_id === "string" && item.stripe_product_id.startsWith("prod_")
      && typeof item.stripe_price_id === "string" && item.stripe_price_id.startsWith("price_"),
  };
}

export function StaffServicePreview({ serviceSlug }: { serviceSlug: PlatePostServiceSlug }) {
  const [state, setState] = useState<PreviewState>({ kind: "hidden" });

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const supabase = client;
    let active = true;

    async function loadPreview() {
      try {
        const context = await invokeAdmin<StaffContext>(supabase, "staff_context");
        if (!active || (context?.role !== "owner" && context?.role !== "admin")) return;
        setState({ kind: "checking" });
        const result = await invokeAdmin<{ services?: unknown }>(supabase, "service_offerings_list");
        if (!active) return;
        const rows = Array.isArray(result?.services) ? result.services : [];
        const service = rows.map((row) => mapDraftService(row, serviceSlug)).find((row): row is DraftService => row !== null);
        setState(service ? { kind: "ready", service } : { kind: "missing" });
      } catch {
        if (active) setState((current) => current.kind === "checking" ? { kind: "error" } : current);
      }
    }

    void loadPreview();
    return () => { active = false; };
  }, [serviceSlug]);

  if (state.kind === "hidden") return null;

  return (
    <aside className="mt-10 rounded-[28px] border-2 border-dashed border-[var(--color-action)] bg-[var(--color-card)] p-7 shadow-[var(--shadow-elevated)] md:p-9" aria-label="Staff-only draft service preview">
      <p className="m-0 text-xs font-extrabold uppercase tracking-[.12em] text-[var(--color-text)]">Sandbox · staff-only draft preview</p>
      {state.kind === "checking" ? <p className="mb-0 mt-4" role="status">Loading protected offering details…</p> : null}
      {state.kind === "missing" ? <p className="mb-0 mt-4" role="status">No protected offering record matches this route.</p> : null}
      {state.kind === "error" ? <p className="mb-0 mt-4" role="alert">The protected staff preview could not be loaded.</p> : null}
      {state.kind === "ready" ? (
        <div className="mt-5 grid gap-7 lg:grid-cols-[1fr_360px] lg:items-start">
          <div>
            <p className="eyebrow">{state.service.visibility} · {state.service.status}</p>
            <h2>{state.service.title}</h2>
            <p className="mt-4">{state.service.summary}</p>
            <p className="mb-0 font-[var(--font-display)] text-3xl font-bold text-[var(--color-action)]">
              {new Intl.NumberFormat("en-NL", { style: "currency", currency: state.service.currency }).format(state.service.priceCents / 100)}
            </p>
          </div>
          {state.service.checkoutConfigured ? (
            <ServiceCheckout staffPreview serviceSlug={state.service.slug} serviceTitle={state.service.title} />
          ) : (
            <p className="m-0 rounded-2xl bg-[var(--color-surface)] p-5 font-bold" role="status">
              Staff checkout stays disabled until both test Stripe Product and Price IDs are configured.
            </p>
          )}
        </div>
      ) : null}
    </aside>
  );
}
