"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { adminSectionHref, adminSections, canAccessAdminSection, type AdminSectionId } from "@/lib/admin/workspace";
import { useAdminWorkspace } from "@/components/admin/AdminWorkspaceProvider";

import styles from "@/app/admin/admin.module.css";

export default function AdminWorkspaceShell({ section, children }: { section: AdminSectionId; children: ReactNode }) {
  const { viewer, role, busy, notice, dismissNotice } = useAdminWorkspace();
  const navigation = adminSections.filter((item) => canAccessAdminSection(role, item.id));

  return (
    <div className={styles.adminShell}>
      <a className={styles.skipLink} href="#admin-main">Skip staff navigation</a>
      <aside className={styles.sidebar} aria-label="Staff workspace">
        <Link className={styles.adminBrand} href="/" aria-label="Clearstep AI website">
          <Image src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" priority />
          <span>Staff workspace</span>
        </Link>
        <nav className={styles.adminNav} aria-label="Staff workspace navigation">
          {navigation.map((item) => (
            <Link
              className={section === item.id ? styles.activeNavItem : styles.navItem}
              href={adminSectionHref(item.id)}
              aria-current={section === item.id ? "page" : undefined}
              key={item.id}
            >
              <span aria-hidden="true">{item.short}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.livePill}>Live workspace</span>
          <p>Customer, booking and analytics data comes from Clearstep&apos;s protected Supabase project.</p>
          <Link href="/">View public website <span aria-hidden="true">↗</span></Link>
        </div>
      </aside>

      <main className={styles.main} id="admin-main" tabIndex={-1}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.topbarContext}>Clearstep AI</p>
            <h1 className={styles.topbarTitle}>Workshop operations</h1>
          </div>
          <div className={styles.topbarActions}>
            <div className={styles.profile} aria-label={`Signed in as ${viewer.email}, ${role}`}>
              <span className={styles.profileAvatar} aria-hidden="true">{viewer.email.charAt(0).toUpperCase()}</span>
              <span><strong>{viewer.email}</strong><small>{role}</small></span>
            </div>
          </div>
        </header>

        <div className={styles.content} aria-busy={busy !== null}>
          {notice ? (
            <div
              className={`${styles.notice} ${notice.tone === "danger" ? styles.noticeDanger : styles.noticeSuccess}`}
              role={notice.tone === "danger" ? "alert" : "status"}
              aria-live={notice.tone === "danger" ? "assertive" : "polite"}
              aria-atomic="true"
            >
              <strong>{notice.tone === "danger" ? "Action not completed" : "Saved"}</strong>
              <span>{notice.message}</span>
              <button type="button" onClick={dismissNotice} aria-label="Dismiss message">×</button>
            </div>
          ) : null}
          {children}
          <footer className={styles.adminFooter}>
            <span>Clearstep AI staff workspace</span>
            <span>Europe/Amsterdam · Role-checked server actions</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
