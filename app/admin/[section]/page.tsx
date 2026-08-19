import { notFound } from "next/navigation";

import AdminWorkspaceRoute from "@/components/admin/AdminWorkspaceRoute";
import { adminSectionIds, isAdminSection } from "@/lib/admin/workspace";

type AdminSectionPageProps = {
  params: Promise<{ section: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return adminSectionIds.filter((section) => section !== "overview").map((section) => ({ section }));
}

export default async function AdminSectionPage({ params }: AdminSectionPageProps) {
  const { section } = await params;
  if (!isAdminSection(section) || section === "overview") notFound();
  return <AdminWorkspaceRoute section={section} />;
}
