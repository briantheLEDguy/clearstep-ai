"use client";

import {
  ANALYTICS_CONSENT_VERSION,
  type AnalyticsConsent,
} from "@/lib/analytics-consent";
import { getSupabasePublicConfig } from "@/lib/supabase/public-config";

type AnalyticsProperties = Record<string, boolean | number | string | null>;
type ActiveAnalyticsConsent = Extract<AnalyticsConsent, { status: "granted" }>;

const SESSION_STORAGE_KEY = "clearstep_analytics_session";
const COURSE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTM_SOURCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

let activeConsent: ActiveAnalyticsConsent | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function analyticsEndpoint() {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  return {
    url: new URL("/functions/v1/analytics-ingest", config.url),
    key: config.key,
  };
}

async function requestAnalytics<T>(body: Record<string, unknown>, keepalive = false): Promise<T> {
  const endpoint = analyticsEndpoint();
  if (!endpoint) throw new Error("Analytics is not configured.");

  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      apikey: endpoint.key,
      "content-type": "application/json",
    },
    credentials: "omit",
    keepalive,
    referrerPolicy: "no-referrer",
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error("Analytics request was not accepted.");

  const payload: unknown = await response.json();
  if (isRecord(payload) && "data" in payload) return payload.data as T;
  return payload as T;
}

function analyticsSessionId() {
  if (!activeConsent || typeof window === "undefined") return null;

  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const created = window.crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

function validCourseSlug(value: unknown) {
  return typeof value === "string" && COURSE_SLUG_PATTERN.test(value) ? value : null;
}

function validUtmSource(value: unknown) {
  return typeof value === "string" && UTM_SOURCE_PATTERN.test(value) ? value : null;
}

export function activateAnalytics(consent: AnalyticsConsent) {
  activeConsent = consent.status === "granted" && consent.version === ANALYTICS_CONSENT_VERSION
    ? consent
    : null;
}

export function deactivateAnalytics() {
  activeConsent = null;
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // A disabled storage area cannot retain a newly-created analytics identifier.
  }
}

export function analyticsEnabled() {
  return activeConsent !== null;
}

export async function grantAnalyticsConsent() {
  const data = await requestAnalytics<{ consentId?: unknown }>({
    action: "grant",
    policyVersion: ANALYTICS_CONSENT_VERSION,
  });

  if (!isRecord(data) || typeof data.consentId !== "string") {
    throw new Error("Analytics consent was not recorded.");
  }

  return {
    status: "granted" as const,
    version: ANALYTICS_CONSENT_VERSION,
    consentId: data.consentId,
  };
}

export async function withdrawAnalyticsConsent(consentId: string) {
  await requestAnalytics({ action: "withdraw", consentId }, true);
}

export async function trackEvent(name: string, properties: AnalyticsProperties = {}) {
  const consent = activeConsent;
  if (!consent) return;

  const sessionId = analyticsSessionId();
  if (!sessionId) return;

  const eventName = name === "page_view" || name === "course_view" ? name : null;
  if (!eventName) return;

  const utmSource = validUtmSource(properties.utm_source);
  const courseSlug = eventName === "course_view" ? validCourseSlug(properties.course_slug) : null;

  try {
    await requestAnalytics({
      action: "event",
      consentId: consent.consentId,
      sessionId,
      eventName,
      ...(utmSource ? { utmSource } : {}),
      ...(courseSlug ? { courseSlug } : {}),
    });
  } catch {
    // Analytics is optional and must never block a customer action.
  }
}
