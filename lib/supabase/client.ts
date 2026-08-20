"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./public-config";

export { getSupabasePublicConfig, type SupabasePublicConfig } from "./public-config";

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return getSupabasePublicConfig() !== null;
}

export function getSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  if (!browserClient) {
    browserClient = createClient(config.url, config.key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // Keep automatic flow-ID redirects disabled until the query-aware live allowlist passes the deployment runbook.
        flowType: "pkce",
        persistSession: true,
      },
    });
  }

  return browserClient;
}

