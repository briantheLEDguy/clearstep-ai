import type { Metadata } from "next";

import GuidesGate from "@/components/guides/GuidesGate";

export const metadata: Metadata = {
  title: "Guides",
  description: "Practical AI playbooks for Clearstep learners.",
  robots: { index: false, follow: false, nocache: true },
};

export default function GuidesPage() {
  return <div className="brand-surface" data-brand="clearstep"><GuidesGate /></div>;
}
