import Link from "next/link";

const footerLinks = [
  ["Workshops", "/workshops"],
  ["Private workshops", "/private-workshops"],
  ["About", "/about"],
  ["FAQ", "/faq"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Cancellations", "/cancellation"],
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-[var(--navy)] py-14 text-[var(--cream)]">
      <div className="shell grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mb-5 h-auto w-40 brightness-0 invert" src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
          <p className="m-0 max-w-xl text-base text-white/75">
            Practical AI workshops for people who want useful results, clear methods, and room to ask questions.
          </p>
          <a className="mt-5 inline-block font-bold text-[var(--mint)] underline underline-offset-4" href="mailto:brian@bncconsulting.co">
            brian@bncconsulting.co
          </a>
        </div>
        <div className="flex max-w-xl flex-wrap gap-x-6 gap-y-3 text-sm font-semibold" aria-label="Footer links">
          {footerLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </div>
      </div>
      <div className="shell mt-10 border-t border-white/15 pt-6 text-sm text-white/60">
        © 2026 Clearstep AI. Make AI useful. Keep it simple.
      </div>
    </footer>
  );
}
