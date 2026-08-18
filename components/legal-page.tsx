import type { ReactNode } from "react";
import { PublicPage } from "@/components/public-page";

export function LegalPage({ eyebrow, title, updated = "18 August 2026", children }: { eyebrow: string; title: string; updated?: string; children: ReactNode }) {
  return (
    <PublicPage>
      <article className="shell py-16 md:py-24">
        <header className="max-w-4xl border-b border-[var(--border)] pb-10">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.8rem)] leading-[1.03]">{title}</h1>
          <p className="mb-0 mt-5 text-base text-[color:rgba(16,42,67,.62)]">Last updated {updated}</p>
        </header>
        <div className="mt-10 max-w-3xl space-y-9 [&_a]:font-bold [&_a]:text-[var(--action)] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-3xl [&_h2]:leading-tight [&_li]:mb-2 [&_p]:my-3 [&_ul]:pl-6">
          {children}
        </div>
      </article>
    </PublicPage>
  );
}

