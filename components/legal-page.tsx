import type { ReactNode } from "react";
import { PublicPage } from "@/components/public-page";
import { LEGAL_DOCUMENTS, type LegalDocumentKey } from "@/shared/legal-documents";

type LegalPageProps = {
  eyebrow: string;
  document?: LegalDocumentKey;
  title?: string;
  children: ReactNode;
};

export function LegalPage({ eyebrow, document, title, children }: LegalPageProps) {
  const legalDocument = document ? LEGAL_DOCUMENTS[document] : null;
  const heading = title ?? legalDocument?.title;

  if (!heading) throw new Error("LegalPage needs a document or title.");

  return (
    <PublicPage>
      <article className="shell py-16 md:py-24">
        <header className="max-w-4xl border-b border-[var(--border)] pb-10">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-[clamp(2.7rem,7vw,4.8rem)] leading-[1.03]">{heading}</h1>
          {legalDocument ? <p className="mb-0 mt-5 text-base text-[color:rgba(16,42,67,.70)]">Version {legalDocument.version} · Effective {legalDocument.effectiveDate}</p> : null}
        </header>
        <div className="mt-10 max-w-3xl space-y-9 [&_a]:font-bold [&_a]:text-[var(--action)] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-3xl [&_h2]:leading-tight [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </article>
    </PublicPage>
  );
}

