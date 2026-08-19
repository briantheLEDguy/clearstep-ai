"use client";

import dynamic from "next/dynamic";

import AdminWorkspaceShell from "@/components/admin/AdminWorkspaceShell";
import { canAccessAdminSection, type AdminSectionId } from "@/lib/admin/workspace";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceProvider";

import styles from "@/app/admin/admin.module.css";

const OverviewSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.OverviewSection), { loading: () => <SectionLoading /> });
const CatalogSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.CatalogSection), { loading: () => <SectionLoading /> });
const BookingsSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.BookingsSection), { loading: () => <SectionLoading /> });
const WaitlistSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.WaitlistSection), { loading: () => <SectionLoading /> });
const PrivateRequestsSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.PrivateRequestsSection), { loading: () => <SectionLoading /> });
const AnalyticsSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.AnalyticsSection), { loading: () => <SectionLoading /> });
const CustomerRequestsSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.CustomerRequestsSection), { loading: () => <SectionLoading /> });
const TeamSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.TeamSection), { loading: () => <SectionLoading /> });
const AuditSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.AuditSection), { loading: () => <SectionLoading /> });
const IntegrationsSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.IntegrationsSection), { loading: () => <SectionLoading /> });
const AutomationSection = dynamic(() => import("@/components/admin/AdminSections").then((module) => module.AutomationSection), { loading: () => <SectionLoading /> });

const sections = {
  overview: OverviewSection,
  catalog: CatalogSection,
  bookings: BookingsSection,
  waitlist: WaitlistSection,
  private: PrivateRequestsSection,
  analytics: AnalyticsSection,
  requests: CustomerRequestsSection,
  team: TeamSection,
  audit: AuditSection,
  integrations: IntegrationsSection,
  automation: AutomationSection,
} satisfies Record<AdminSectionId, typeof OverviewSection>;

export default function AdminWorkspaceRoute({ section }: { section: AdminSectionId }) {
  const { role } = useAdminWorkspace();
  const Section = canAccessAdminSection(role, section) ? sections[section] : OverviewSection;
  return <AdminWorkspaceShell section={canAccessAdminSection(role, section) ? section : "overview"}><Section /></AdminWorkspaceShell>;
}

function SectionLoading() {
  return <section className={styles.section} aria-live="polite"><p className={styles.eyebrow}>Staff workspace</p><p>Loading this operation…</p></section>;
}
