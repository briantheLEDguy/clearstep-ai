"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type AnalyticsProperties = Record<string, boolean | number | string | null>;

function sessionId() {
  const storageKey = "clearstep_analytics_session";
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = window.crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return null;
  }
}

export async function trackEvent(name: string, properties: AnalyticsProperties = {}) {
  const client = getSupabaseBrowserClient();
  if (!client || typeof window === "undefined") return;

  try {
    await client.functions.invoke("analytics-ingest", {
      body: {
        eventName: name,
        anonymousId: sessionId(),
        pagePath: window.location.pathname,
        properties,
      },
    });
  } catch {
    // Analytics is intentionally best-effort and never blocks a customer action.
  }
}
