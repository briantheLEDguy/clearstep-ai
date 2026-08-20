"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type AuthNavState = "loading" | "signed-in" | "signed-out";

export function AuthNavAction() {
  const [state, setState] = useState<AuthNavState>(
    isSupabaseConfigured() ? "loading" : "signed-out",
  );

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;

    let active = true;
    const { data: authListener } = client.auth.onAuthStateChange(
      (_event, session: Session | null) => {
        if (active) setState(session?.user ? "signed-in" : "signed-out");
      },
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (state === "loading") {
    return <span className="nav-account-loading" aria-hidden="true" />;
  }

  if (state === "signed-out") {
    return <Link className="nav-sign-in" href="/sign-in">Sign in</Link>;
  }

  return (
    <Link className="nav-account-action" href="/account" aria-label="Your account — signed in">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M12 12.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm-7.25 7.5c.56-3.46 3.56-5.75 7.25-5.75s6.69 2.29 7.25 5.75H4.75Z" />
      </svg>
      <span className="nav-account-badge" aria-hidden="true">✓</span>
    </Link>
  );
}
