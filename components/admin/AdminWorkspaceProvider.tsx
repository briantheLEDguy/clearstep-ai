"use client";

import type { MutableRefObject, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AdminApiError, beginGoogleConnection, inviteStaff, invokeAdmin, type AdminAction } from "@/lib/admin/admin-api";
import { isStaffRole, type StaffRole } from "@/lib/admin/dashboard-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import styles from "@/app/admin/admin.module.css";

export type AdminViewer = { id: string; email: string };
export type AdminNotice = { tone: "success" | "danger"; message: string };
export type AdminResourceKey =
  | "overview"
  | "catalog"
  | "bookings"
  | "orders"
  | "waitlist"
  | "private"
  | "analytics"
  | "serviceAnalytics"
  | "requests"
  | "team"
  | "audit"
  | "integrations"
  | "automation"
  | "operations";

type StaffContext = { role?: unknown };
type ResourceCacheEntry = { version: number; data: unknown };
type GateState =
  | { kind: "checking" }
  | { kind: "allowed"; viewer: AdminViewer; role: StaffRole }
  | { kind: "signed-out" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "unconfigured" };

export type ResourceState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

type MutationInput = {
  operation: string;
  action: AdminAction;
  payload: Record<string, unknown>;
  success: string;
  invalidate: AdminResourceKey[];
};

type AdminWorkspaceValue = {
  client: SupabaseClient;
  viewer: AdminViewer;
  role: StaffRole;
  busy: string | null;
  notice: AdminNotice | null;
  resourceVersions: Partial<Record<AdminResourceKey, number>>;
  cache: MutableRefObject<Map<AdminResourceKey, ResourceCacheEntry>>;
  inFlight: MutableRefObject<Map<string, Promise<unknown>>>;
  dismissNotice: () => void;
  invalidate: (keys: AdminResourceKey[]) => void;
  mutate: (input: MutationInput) => Promise<boolean>;
  sendInvite: (email: string, role: "admin" | "analyst") => Promise<boolean>;
  connectGoogle: () => Promise<void>;
};

const AdminWorkspaceContext = createContext<AdminWorkspaceValue | null>(null);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "This information is temporarily unavailable.";
}

function AccessScreen({ state, onRetry }: { state: GateState; onRetry: () => void }) {
  const copy = state.kind === "checking"
    ? "Checking staff access…"
    : state.kind === "signed-out"
      ? "Sign in with your BNC Consulting staff email to continue."
      : state.kind === "unconfigured"
        ? "The staff workspace is not connected in this environment."
        : state.kind === "unavailable"
          ? state.message
          : "This account does not have access to the BNC Consulting staff workspace.";

  return (
    <main className={styles.loadingScreen} aria-live="polite" aria-atomic="true">
      <section className={styles.accessCard}>
        <p className={styles.accessBrand}>BNC Consulting</p>
        <h1>Staff workspace</h1>
        <p>{copy}</p>
        {state.kind === "signed-out" || state.kind === "forbidden" ? (
          <Link className={styles.primaryLink} href="/sign-in?next=%2Fadmin">Sign in</Link>
        ) : null}
        {state.kind === "unavailable" ? (
          <button className={styles.primaryButton} type="button" onClick={onRetry}>Try again</button>
        ) : null}
      </section>
    </main>
  );
}

export default function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const client = getSupabaseBrowserClient();
  const [state, dispatchGate] = useReducer((_: GateState, next: GateState) => next, client ? { kind: "checking" } : { kind: "unconfigured" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [resourceVersions, setResourceVersions] = useState<Partial<Record<AdminResourceKey, number>>>({});
  const cache = useRef(new Map<AdminResourceKey, ResourceCacheEntry>());
  const inFlight = useRef(new Map<string, Promise<unknown>>());

  const invalidate = useCallback((keys: AdminResourceKey[]) => {
    const affected = keys.includes("automation") && !keys.includes("operations")
      ? [...keys, "operations" as const]
      : keys;
    for (const key of affected) cache.current.delete(key);
    setResourceVersions((current) => {
      const next = { ...current };
      for (const key of affected) next[key] = (current[key] ?? 0) + 1;
      return next;
    });
  }, []);

  const clearResources = useCallback(() => {
    cache.current.clear();
    setResourceVersions((current) => {
      const next = { ...current };
      for (const key of ["overview", "catalog", "bookings", "orders", "waitlist", "private", "analytics", "serviceAnalytics", "requests", "team", "audit", "integrations", "automation", "operations"] as const) {
        next[key] = (current[key] ?? 0) + 1;
      }
      return next;
    });
  }, []);

  const verifyStaffAccess = useCallback(async () => {
    if (!client) {
      dispatchGate({ kind: "unconfigured" });
      return;
    }

    if (state.kind !== "allowed") dispatchGate({ kind: "checking" });
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      clearResources();
      dispatchGate({ kind: "signed-out" });
      return;
    }

    try {
      const context = await invokeAdmin<StaffContext>(client, "staff_context");
      if (!isStaffRole(context?.role)) {
        clearResources();
        dispatchGate({ kind: "forbidden" });
        return;
      }
      clearResources();
      dispatchGate({
        kind: "allowed",
        role: context.role,
        viewer: { id: userData.user.id, email: userData.user.email ?? "Staff member" },
      });
    } catch (error) {
      clearResources();
      if (error instanceof AdminApiError && ["staff_access_required", "staff_membership_inactive", "staff_admin_required"].includes(error.code)) {
        dispatchGate({ kind: "forbidden" });
        return;
      }
      dispatchGate({ kind: "unavailable", message: errorText(error) });
    }
  }, [clearResources, client, state.kind]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => {
      void verifyStaffAccess();
    }, 0);
    if (!client) return () => window.clearTimeout(initialCheck);

    const { data: authListener } = client.auth.onAuthStateChange(() => {
      void verifyStaffAccess();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void verifyStaffAccess();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initialCheck);
      authListener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, verifyStaffAccess]);

  const mutate = useCallback(async ({ operation, action, payload, success, invalidate: keys }: MutationInput) => {
    if (!client) return false;
    setBusy(operation);
    setNotice(null);
    try {
      await invokeAdmin(client, action, payload);
      setNotice({ tone: "success", message: success });
      invalidate(keys);
      return true;
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, invalidate]);

  const sendInvite = useCallback(async (email: string, role: "admin" | "analyst") => {
    if (!client) return false;
    setBusy("invite");
    setNotice(null);
    try {
      await inviteStaff(client, email, role);
      setNotice({ tone: "success", message: `Invitation sent to ${email}.` });
      invalidate(["team"]);
      return true;
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }, [client, invalidate]);

  const connectGoogle = useCallback(async () => {
    if (!client) return;
    setBusy("google-connect");
    setNotice(null);
    try {
      const url = await beginGoogleConnection(client);
      window.location.assign(url);
    } catch (error) {
      setNotice({ tone: "danger", message: errorText(error) });
      setBusy(null);
    }
  }, [client]);

  const value = useMemo<AdminWorkspaceValue | null>(() => {
    if (!client || state.kind !== "allowed") return null;
    return {
      client,
      viewer: state.viewer,
      role: state.role,
      busy,
      notice,
      resourceVersions,
      cache,
      inFlight,
      dismissNotice: () => setNotice(null),
      invalidate,
      mutate,
      sendInvite,
      connectGoogle,
    };
  }, [busy, client, connectGoogle, invalidate, mutate, notice, resourceVersions, sendInvite, state]);

  if (!value) return <AccessScreen state={state} onRetry={() => void verifyStaffAccess()} />;
  return <AdminWorkspaceContext.Provider value={value}>{children}</AdminWorkspaceContext.Provider>;
}

export function useAdminWorkspace() {
  const value = useContext(AdminWorkspaceContext);
  if (!value) throw new Error("Admin workspace context is unavailable.");
  return value;
}

export function useAdminResource<T>(
  key: AdminResourceKey,
  loader: () => Promise<T>,
): ResourceState<T> & { reload: () => void } {
  const { cache, inFlight, invalidate, resourceVersions } = useAdminWorkspace();
  const version = resourceVersions[key] ?? 0;
  const [state, dispatchResource] = useReducer((_: ResourceState<T>, next: ResourceState<T>) => next, { data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;
    const cached = cache.current.get(key);
    if (cached?.version === version) {
      dispatchResource({ data: cached.data as T, error: null, loading: false });
      return () => { active = false; };
    }

    dispatchResource({ data: state.data, error: null, loading: true });
    const requestKey = `${key}:${version}`;
    let request = inFlight.current.get(requestKey) as Promise<T> | undefined;
    if (!request) {
      request = loader();
      inFlight.current.set(requestKey, request);
    }

    void request.then((data) => {
      cache.current.set(key, { version, data });
      if (active) dispatchResource({ data, error: null, loading: false });
    }).catch((error: unknown) => {
      if (active) dispatchResource({ data: state.data, error: errorText(error), loading: false });
    }).finally(() => {
      inFlight.current.delete(requestKey);
    });

    return () => { active = false; };
  }, [cache, inFlight, key, loader, state.data, version]);

  return {
    ...state,
    reload: () => invalidate([key]),
  };
}
