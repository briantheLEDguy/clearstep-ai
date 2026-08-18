import type { Metadata } from "next";

import AdminGate from "@/components/admin/AdminGate";

export const metadata: Metadata = {
  title: "Staff workspace",
  description: "Clearstep AI workshop operations and reporting.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function AdminPage() {
  return <AdminGate />;
}
