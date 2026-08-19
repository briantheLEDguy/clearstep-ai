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
        flowType: "pkce",
        persistSession: true,
      },
    });
  }

  return browserClient;
}

