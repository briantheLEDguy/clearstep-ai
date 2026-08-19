"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ANALYTICS_CONSENT_COOKIE,
  analyticsConsentCookie,
  ANALYTICS_CONSENT_VERSION,
  analyticsWithdrawalCookie,
  clearAnalyticsConsentCookie,
  clearAnalyticsWithdrawalCookie,
  isCurrentAnalyticsConsent,
  readAnalyticsConsent,
  readAnalyticsWithdrawal,
  type AnalyticsConsent,
} from "@/lib/analytics-consent";
import {
  activateAnalytics,
  deactivateAnalytics,
  grantAnalyticsConsent,
  withdrawAnalyticsConsent,
} from "@/lib/analytics";

type AnalyticsConsentContextValue = {
  enabled: boolean;
  openSettings: () => void;
};

const AnalyticsConsentContext = createContext<AnalyticsConsentContextValue | null>(null);

function secureCookie() {
  return window.location.protocol === "https:";
}

function writeConsent(consent: AnalyticsConsent) {
  document.cookie = analyticsConsentCookie(consent, secureCookie());
}

function clearPendingWithdrawal() {
  document.cookie = clearAnalyticsWithdrawalCookie(secureCookie());
}

function queueWithdrawal(consentId: string) {
  document.cookie = analyticsWithdrawalCookie(consentId, secureCookie());
}

export function useAnalyticsConsent() {
  const context = useContext(AnalyticsConsentContext);
  if (!context) {
    throw new Error("useAnalyticsConsent must be used within AnalyticsConsentProvider.");
  }
  return context;
}

export function AnalyticsConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const completeWithdrawal = useCallback(async (consentId: string) => {
    try {
      await withdrawAnalyticsConsent(consentId);
      clearPendingWithdrawal();
    } catch {
      // This strictly necessary, short-lived cookie retries only a withdrawal
      // that the visitor already chose. It never enables or identifies analytics.
      queueWithdrawal(consentId);
    }
  }, []);

  useEffect(() => {
    // The server cannot read this client-only preference. Queue the state update
    // after hydration so the initial server/client markup stays identical.
    const frame = window.requestAnimationFrame(() => {
      const cookie = document.cookie;
      const stored = readAnalyticsConsent(cookie);
      const pendingWithdrawal = readAnalyticsWithdrawal(cookie);
      const hasStoredChoice = cookie.includes(`${ANALYTICS_CONSENT_COOKIE}=`);
      if (stored && isCurrentAnalyticsConsent(stored)) {
        setConsent(stored);
        if (stored.status === "granted" && !pendingWithdrawal) activateAnalytics(stored);
        else deactivateAnalytics();
      } else if (hasStoredChoice || pendingWithdrawal) {
        deactivateAnalytics();
        if (hasStoredChoice) document.cookie = clearAnalyticsConsentCookie(secureCookie());
      }
      if (pendingWithdrawal) void completeWithdrawal(pendingWithdrawal);
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completeWithdrawal]);

  const enabled = consent?.status === "granted" && consent.version === ANALYTICS_CONSENT_VERSION;
  const showPrompt = ready && consent === null;
  const showSettings = ready && settingsOpen;

  function restoreFocus() {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target) window.requestAnimationFrame(() => target.focus());
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  function openSettings() {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setError("");
    setSettingsOpen(true);
  }

  useEffect(() => {
    if (!showPrompt && !showSettings) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => acceptButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(frame);
      if (dialog.open) dialog.close();
      // A native dialog keeps the rest of the page inert while it is open, so
      // return focus only after closing it. The initial consent prompt has no
      // user invoker; settings does.
      if (showSettings) restoreFocus();
    };
  }, [showPrompt, showSettings]);

  async function acceptAnalytics() {
    setSaving(true);
    setError("");
    try {
      const granted = await grantAnalyticsConsent();
      writeConsent(granted);
      activateAnalytics(granted);
      setConsent(granted);
      closeSettings();
    } catch {
      setError("We could not save that choice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function rejectAnalytics() {
    deactivateAnalytics();
    const denied: AnalyticsConsent = { status: "denied", version: ANALYTICS_CONSENT_VERSION };
    writeConsent(denied);
    setConsent(denied);
    closeSettings();
  }

  function withdrawAnalytics() {
    const consentId = consent?.status === "granted" ? consent.consentId : null;
    rejectAnalytics();
    if (consentId) void completeWithdrawal(consentId);
  }

  return (
    <AnalyticsConsentContext.Provider value={{ enabled, openSettings }}>
      {children}
      {(showPrompt || showSettings) && (
        <dialog
          aria-describedby="analytics-consent-description"
          aria-labelledby="analytics-consent-title"
          className="fixed inset-x-0 bottom-0 m-0 w-full max-w-none border-0 bg-transparent p-4 backdrop:bg-black/45 sm:inset-0 sm:m-auto sm:max-w-xl"
          onCancel={(event) => {
            // The first prompt must receive an explicit choice. Settings can
            // be dismissed with Escape and reliably returns focus to its
            // persistent footer control through the effect cleanup above.
            event.preventDefault();
            if (showSettings && !saving) closeSettings();
          }}
          ref={dialogRef}
        >
          <section
            className="w-full max-w-xl rounded-2xl bg-[var(--cream)] p-6 text-[var(--navy)] shadow-2xl"
          >
            <h2 id="analytics-consent-title" className="m-0 text-2xl font-black">Optional website analytics</h2>
            <p id="analytics-consent-description" className="mb-5 mt-3 text-sm leading-6 text-[var(--navy)]/80">
              With your permission, we measure anonymous page and workshop views to improve Clearstep. We do not use this for bookings, accounts, payments, or advertising.
            </p>
            {enabled && (
              <p className="mb-5 rounded-lg bg-[var(--mint)]/20 p-3 text-sm">
                Analytics is currently on. You can turn it off at any time; this removes the related raw analytics events.
              </p>
            )}
            {error && <p className="mb-5 text-sm font-semibold text-red-800" role="alert">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
                onClick={() => void acceptAnalytics()}
                ref={acceptButtonRef}
                type="button"
              >
                {saving ? "Saving…" : "Accept analytics"}
              </button>
              <button
                className="rounded-full border border-[var(--navy)] px-5 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
                onClick={enabled ? withdrawAnalytics : rejectAnalytics}
                type="button"
              >
                {enabled ? "Turn off analytics" : "Reject analytics"}
              </button>
              {showSettings && (
                <button
                  className="px-3 py-3 text-sm font-bold underline underline-offset-4"
                  disabled={saving}
                  onClick={closeSettings}
                  type="button"
                >
                  Close
                </button>
              )}
            </div>
          </section>
        </dialog>
      )}
    </AnalyticsConsentContext.Provider>
  );
}
