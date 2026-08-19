export const ANALYTICS_CONSENT_COOKIE = "clearstep_analytics_consent";
export const ANALYTICS_WITHDRAWAL_COOKIE = "clearstep_analytics_withdrawal";
export const ANALYTICS_CONSENT_VERSION = "2026-08-19";
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const ANALYTICS_WITHDRAWAL_MAX_AGE_SECONDS = 31 * 24 * 60 * 60;

export type AnalyticsConsent =
  | { status: "granted"; version: string; consentId: string }
  | { status: "denied"; version: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validConsent(value: unknown): value is AnalyticsConsent {
  if (!isRecord(value) || typeof value.version !== "string") return false;
  if (value.status === "denied") return true;
  return value.status === "granted"
    && typeof value.consentId === "string"
    && UUID_PATTERN.test(value.consentId);
}

function cookieValue(cookie: string, name: string) {
  const prefix = `${name}=`;
  const entry = cookie.split(/;\s*/u).find((item) => item.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

export function readAnalyticsConsent(cookie: string): AnalyticsConsent | null {
  const value = cookieValue(cookie, ANALYTICS_CONSENT_COOKIE);
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    return validConsent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isCurrentAnalyticsConsent(consent: AnalyticsConsent | null) {
  return consent?.version === ANALYTICS_CONSENT_VERSION;
}

export function analyticsConsentCookie(consent: AnalyticsConsent, secure: boolean) {
  const attributes = [
    `${ANALYTICS_CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}`,
    "Path=/",
    `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearAnalyticsConsentCookie(secure: boolean) {
  const attributes = [
    `${ANALYTICS_CONSENT_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function readAnalyticsWithdrawal(cookie: string) {
  const value = cookieValue(cookie, ANALYTICS_WITHDRAWAL_COOKIE);
  return value && UUID_PATTERN.test(value) ? value : null;
}

export function analyticsWithdrawalCookie(consentId: string, secure: boolean) {
  const attributes = [
    `${ANALYTICS_WITHDRAWAL_COOKIE}=${consentId}`,
    "Path=/",
    `Max-Age=${ANALYTICS_WITHDRAWAL_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearAnalyticsWithdrawalCookie(secure: boolean) {
  const attributes = [
    `${ANALYTICS_WITHDRAWAL_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
