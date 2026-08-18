"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { invokeAdmin } from "@/lib/admin/admin-api";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type StaffContext = {
  role?: unknown;
};

export default function AdminNavLink() {
  const client = getSupabaseBrowserClient();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!client) return;
    const supabase = client;
    let active = true;

    async function updateVisibility() {
      const { data } = await supabase.auth.getUser();
      if (!active || !data.user) {
        if (active) setVisible(false);
        return;
      }

      try {
        const context = await invokeAdmin<StaffContext>(supabase, "staff_context");
        if (active) setVisible(context?.role === "owner" || context?.role === "admin");
      } catch {
        if (active) setVisible(false);
      }
    }

    void updateVisibility();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void updateVisibility();
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [client]);

  return visible ? <Link className="nav-admin" href="/admin">Admin</Link> : null;
}
