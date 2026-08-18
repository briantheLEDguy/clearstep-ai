import type { ReactNode } from "react";

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="shell py-14 md:py-20">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="max-w-4xl text-[clamp(2.5rem,6vw,4rem)] leading-[1.04]">{title}</h1>
      <div className="mt-6 max-w-3xl text-lg leading-relaxed text-[var(--text-muted)]">{children}</div>
    </section>
  );
}

