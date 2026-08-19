import type { Metadata } from "next";

import AdminWorkspaceProvider from "@/components/admin/AdminWorkspaceProvider";

export const metadata: Metadata = {
  title: "Staff workspace",
  description: "BNC Consulting workshop, service-order, and reporting operations.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminWorkspaceProvider>{children}</AdminWorkspaceProvider>;
}
