import type { StaffRole } from "@/lib/admin/dashboard-data";

export const adminSectionIds = [
  "overview",
  "catalog",
  "bookings",
  "waitlist",
  "private",
  "analytics",
  "requests",
  "team",
  "audit",
  "integrations",
  "automation",
] as const;

export type AdminSectionId = (typeof adminSectionIds)[number];

export type AdminSectionConfig = {
  id: AdminSectionId;
  label: string;
  short: string;
  minimumRole: StaffRole;
};

const roleRank: Record<StaffRole, number> = {
  analyst: 0,
  admin: 1,
  owner: 2,
};

export const adminSections: AdminSectionConfig[] = [
  { id: "overview", label: "Overview", short: "OV", minimumRole: "analyst" },
  { id: "catalog", label: "Courses & sessions", short: "CS", minimumRole: "admin" },
  { id: "bookings", label: "Bookings", short: "BK", minimumRole: "admin" },
  { id: "waitlist", label: "Waitlist", short: "WL", minimumRole: "admin" },
  { id: "private", label: "Private requests", short: "PR", minimumRole: "admin" },
  { id: "analytics", label: "Analytics", short: "AN", minimumRole: "analyst" },
  { id: "requests", label: "Customer requests", short: "CR", minimumRole: "admin" },
  { id: "team", label: "Team", short: "TM", minimumRole: "owner" },
  { id: "audit", label: "Audit log", short: "AU", minimumRole: "owner" },
  { id: "integrations", label: "Integrations", short: "IN", minimumRole: "owner" },
  { id: "automation", label: "Automation", short: "AT", minimumRole: "owner" },
];

export function isAdminSection(value: string): value is AdminSectionId {
  return (adminSectionIds as readonly string[]).includes(value);
}

export function canAccessAdminSection(role: StaffRole, section: AdminSectionId) {
  const config = adminSections.find((item) => item.id === section);
  return Boolean(config && roleRank[role] >= roleRank[config.minimumRole]);
}

export function adminSectionHref(section: AdminSectionId) {
  return section === "overview" ? "/admin" : `/admin/${section}`;
}
