import type { ReactNode } from "react";

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="shell py-16 md:py-24">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="max-w-4xl text-[clamp(2.7rem,7vw,4.8rem)] leading-[1.03]">{title}</h1>
      <div className="mt-7 max-w-3xl text-xl leading-relaxed text-[color:rgba(16,42,67,.82)]">{children}</div>
    </section>
  );
}

