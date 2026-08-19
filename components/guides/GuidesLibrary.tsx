"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { guideSeries } from "@/lib/guides";

import styles from "./guides.module.css";

type Article = (typeof guideSeries)[number]["articles"][number];
type GuideStep = Article["steps"][number];

function SectionIntro({ label, title, copy }: { label: string; title: string; copy?: string }) {
  return (
    <header className={styles.sectionIntro}>
      <p className={styles.sectionLabel}>{label}</p>
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

function WhyBlock({ article, title = "Why this works" }: { article: Article; title?: string }) {
  return (
    <section className={styles.why}>
      <p className={styles.sectionLabel}>{title}</p>
      <p>{article.why}</p>
    </section>
  );
}

function StepsBlock({
  article,
  label,
  title,
  variant,
  markers,
}: {
  article: Article;
  label: string;
  title: string;
  variant: "numbered" | "timeline" | "cards" | "gates" | "cycle";
  markers?: string[];
}) {
  return (
    <section className={styles.contentSection}>
      <SectionIntro label={label} title={title} />
      <div className={[styles.stepCollection, styles[variant]].join(" ")}>
        {article.steps.map((step: GuideStep, index: number) => (
          <article className={styles.step} key={step.title}>
            <span>{markers?.[index] ?? String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.tip ? <p className={styles.tip}><strong>Quick tip</strong>{step.tip}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PromptBlock({
  article,
  title = "Try it with your own work",
  label = "Copy this",
  copied,
  onCopy,
}: {
  article: Article;
  title?: string;
  label?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className={styles.promptBlock}>
      <div className={styles.promptHeading}>
        <div>
          <p className={styles.sectionLabel}>{label}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy prompt"}</button>
      </div>
      <p className={styles.toolNote}>Use in {article.tools.join(", ")}</p>
      <pre><code>{article.prompt}</code></pre>
    </section>
  );
}

function ChecklistBlock({ article, title = "Before you call it done", label = "Check your result" }: { article: Article; title?: string; label?: string }) {
  return (
    <section className={styles.checklist}>
      <SectionIntro label={label} title={title} />
      <ul>{article.checks.map((check: string) => <li key={check}>{check}</li>)}</ul>
    </section>
  );
}

function SafetyBlock({ article, title = "Keep it safe" }: { article: Article; title?: string }) {
  return <aside className={styles.safety}><strong>{title}</strong><p>{article.safety}</p></aside>;
}

function ImproveBlock({ article, label = "One useful refinement" }: { article: Article; label?: string }) {
  return (
    <aside className={styles.improve}>
      <span>{label}</span>
      <p>{article.improveIt}</p>
    </aside>
  );
}

function SplitBlock({
  label,
  title,
  left,
  right,
}: {
  label: string;
  title: string;
  left: { eyebrow: string; title: string; body: string };
  right: { eyebrow: string; title: string; body: string };
}) {
  return (
    <section className={styles.contentSection}>
      <SectionIntro label={label} title={title} />
      <div className={styles.splitBlock}>
        {[left, right].map((side) => (
          <article key={side.eyebrow}>
            <span>{side.eyebrow}</span>
            <h3>{side.title}</h3>
            <p>{side.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GuideBody({
  article,
  copied,
  onCopy,
}: {
  article: Article;
  copied: boolean;
  onCopy: () => void;
}) {
  switch (article.format) {
    case "field-guide":
      return (
        <>
          <WhyBlock article={article} title="The useful mental model" />
          <SplitBlock
            label="Divide the work"
            title="AI predicts. You decide."
            left={{ eyebrow: "Let AI", title: "Create options", body: "Outline, reorganize, shorten, or turn the facts you supply into a first draft." }}
            right={{ eyebrow: "You must", title: "Own the result", body: "Choose the goal, protect private information, verify claims, restore your voice, and approve the final copy." }}
          />
          <StepsBlock article={article} label="Your first run" title="Make one safe draft" variant="numbered" />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Ask for a draft with visible gaps" label="Starter prompt" />
          <SafetyBlock article={article} title="The boundary" />
          <ChecklistBlock article={article} title="A usable draft passes three tests" label="Finish line" />
          <ImproveBlock article={article} />
        </>
      );
    case "prompt-lab":
      return (
        <>
          <WhyBlock article={article} title="The lab idea" />
          <section className={styles.contentSection}>
            <SectionIntro label="Prompt anatomy" title="Five parts beat one clever sentence" copy="Build a small, complete brief. Each part removes a different kind of ambiguity." />
            <div className={styles.ingredientGrid}>
              {[
                ["01", "Role", "A useful perspective"],
                ["02", "Context", "Audience and safe facts"],
                ["03", "Task", "One concrete verb"],
                ["04", "Constraints", "The visible boundaries"],
                ["05", "Output", "An inspectable shape"],
              ].map(([number, title, body]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}
            </div>
          </section>
          <section className={styles.beforeAfter}>
            <SectionIntro label="Prompt teardown" title="From wish to working brief" />
            <div>
              <article><span>Too open</span><p>“Make this better.”</p></article>
              <article><span>Testable</span><p>“Rewrite this update for a busy sponsor. Keep it under 120 words, use only supplied facts, lead with the decision, and mark gaps [VERIFY].”</p></article>
            </div>
          </section>
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Fill the five fields" label="Lab template" />
          <StepsBlock article={article} label="Test loop" title="Improve the instruction, not the pleading" variant="cards" />
          <SafetyBlock article={article} title="Sanitize the lab" />
          <ChecklistBlock article={article} title="Your prompt is reusable when…" label="Lab result" />
          <ImproveBlock article={article} label="Next experiment" />
        </>
      );
    case "four-pass-audit":
      return (
        <>
          <aside className={[styles.safety, styles.auditWarning].join(" ")}><strong>The fluency trap</strong><p>Polished wording can hide wrong facts, missing context, or a response that never answered the brief.</p></aside>
          <WhyBlock article={article} title="Why separate passes" />
          <StepsBlock article={article} label="The audit board" title="Review one risk at a time" variant="cards" markers={["FACT", "FIT", "RISK", "RIGHTS", "CRITIC", "SIGN-OFF"]} />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Invite criticism—not certification" label="Second set of eyes" />
          <SplitBlock
            label="The verdict"
            title="Do not force a pass"
            left={{ eyebrow: "Keep or revise", title: "Low-risk and traceable", body: "The facts have sources, the brief is satisfied, and you can safely correct the remaining wording." }}
            right={{ eyebrow: "Escalate or discard", title: "Consequential or unprovable", body: "A claim cannot be verified, data use is questionable, or qualified review is required." }}
          />
          <ChecklistBlock article={article} title="Before the draft leaves your hands" label="Release gate" />
          <ImproveBlock article={article} />
        </>
      );
    case "planning-sprint":
      return (
        <>
          <StepsBlock article={article} label="Set a timer" title="A planning sprint with a hard stop" variant="timeline" markers={["0:00", "2:00", "4:00", "6:00", "8:00", "10:00"]} />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Make capacity a hard constraint" label="Planning brief" />
          <SplitBlock
            label="Decision boundary"
            title="Keep judgment on your side"
            left={{ eyebrow: "AI proposes", title: "Order and shape", body: "Grouping, a draft sequence, visible conflicts, and a schedule that follows supplied capacity." }}
            right={{ eyebrow: "You decide", title: "Value and commitment", body: "What matters today, how long the work really takes, what moves, and what enters the calendar." }}
          />
          <WhyBlock article={article} />
          <ChecklistBlock article={article} title="Your day fits when…" label="Reality check" />
          <SafetyBlock article={article} />
          <ImproveBlock article={article} label="Tonight’s feedback loop" />
        </>
      );
    case "evidence-board":
      return (
        <>
          <section className={styles.contentSection}>
            <SectionIntro label="Three-column lens" title="Sort by what happened—not what sounds likely" />
            <div className={styles.evidenceGrid}>
              {[
                ["Settled", "Decision", "A choice the meeting explicitly made."],
                ["Committed", "Action", "A task someone explicitly accepted."],
                ["Unresolved", "Open question", "A point that still needs information or a decision."],
              ].map(([label, title, body]) => <article key={title}><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}
            </div>
          </section>
          <section className={styles.evidenceExample}>
            <SectionIntro label="Evidence test" title="A likely action is not yet a commitment" />
            <blockquote>“We could ask Finance for the updated estimate.”</blockquote>
            <p><strong>Log it as:</strong> Open question. Owner: [NOT STATED]. Due date: [NOT STATED].</p>
          </section>
          <StepsBlock article={article} label="Build the board" title="Extract, prove, confirm" variant="gates" markers={["PERMIT", "REDACT", "EXTRACT", "PROVE", "CONFIRM", "STORE"]} />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Make missing details impossible to hide" label="Extraction prompt" />
          <ChecklistBlock article={article} title="The log stays a draft until…" label="Human confirmation" />
          <SafetyBlock article={article} title="Protect the room" />
          <ImproveBlock article={article} />
        </>
      );
    case "message-clinic":
      return (
        <>
          <section className={styles.beforeAfter}>
            <SectionIntro label="Before and after" title="Move the decision into view" />
            <div>
              <article><span>Buried</span><p>“Following our recent conversations, I wanted to check whether you might have time to look at the draft…”</p></article>
              <article><span>Clear</span><p>“Could you approve the draft by 15:00 Thursday? The two open points are highlighted on page 2.”</p></article>
            </div>
          </section>
          <StepsBlock article={article} label="Message clinic" title="Ask → context → exit" variant="cards" />
          <SplitBlock
            label="Choose the temperature"
            title="Direct and warm can both be clear"
            left={{ eyebrow: "Direct", title: "Established path", body: "Lead with the request, state the deadline, and add only decision-critical context." }}
            right={{ eyebrow: "Warm", title: "Relationship needs space", body: "Acknowledge the person briefly, then make the same request and deadline explicit." }}
          />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Generate two options, then restore your voice" label="Two-version prompt" />
          <ChecklistBlock article={article} title="Read only what can hurt you" label="20-second send check" />
          <SafetyBlock article={article} title="Do not outsource the send" />
          <ImproveBlock article={article} />
        </>
      );
    case "workflow-canvas":
      return (
        <>
          <WhyBlock article={article} title="Why map before writing" />
          <StepsBlock article={article} label="Fill the canvas" title="Six boxes reveal the real workflow" variant="cards" markers={["TRIGGER", "INPUTS", "DRAFT", "DRY RUN", "OWNER", "VERSION"]} />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Organize the run without inventing the process" label="Canvas-to-checklist" />
          <SplitBlock
            label="Useful detail"
            title="Prefer evidence over false certainty"
            left={{ eyebrow: "Keep", title: "Observable instructions", body: "Clear verbs, named decisions, required checks, and a finish line another person can verify." }}
            right={{ eyebrow: "Mark [CONFIRM]", title: "Unknown operating truth", body: "Unverified policy, permission, ownership, exceptions, or steps the example did not reveal." }}
          />
          <ChecklistBlock article={article} title="The page is ready to operate when…" label="Walk the line" />
          <SafetyBlock article={article} title="Preserve the controls" />
          <ImproveBlock article={article} label="Improve from use" />
        </>
      );
    case "codex-runbook":
      return (
        <>
          <SafetyBlock article={article} title="Start below the risk line" />
          <StepsBlock article={article} label="The runbook" title="Stop at every evidence gate" variant="gates" markers={["GATE 1", "GATE 2", "GATE 3", "GATE 4", "GATE 5", "GATE 6", "GATE 7"]} />
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Give Codex a testable brief" label="Task brief" />
          <WhyBlock article={article} title="Why the gates matter" />
          <section className={styles.contentSection}>
            <SectionIntro label="Three kinds of evidence" title="A green check is necessary, not sufficient" />
            <div className={styles.evidenceGrid}>
              <article><span>Scope</span><h3>Expected files</h3><p>No surprise cleanup, dependency churn, or unrelated edits.</p></article>
              <article><span>Behavior</span><h3>Checks pass</h3><p>The normal path and at least one invalid input behave as agreed.</p></article>
              <article><span>Judgment</span><h3>Human approval</h3><p>A reviewer can explain the change, remaining risk, and reversal path.</p></article>
            </div>
          </section>
          <ChecklistBlock article={article} title="Do not ship until all are true" label="Commit gate" />
          <ImproveBlock article={article} />
        </>
      );
    case "improvement-loop":
      return (
        <>
          <StepsBlock article={article} label="The loop" title="Notice → choose → test → decide" variant="cycle" />
          <section className={styles.contentSection}>
            <SectionIntro label="Pick one measure" title="Measure the friction you meant to change" />
            <div className={styles.metricRow}>
              {["Minutes", "Errors", "Handoffs", "Questions"].map((metric) => <span key={metric}>{metric}</span>)}
            </div>
          </section>
          <PromptBlock article={article} copied={copied} onCopy={onCopy} title="Ask for options without asking for blame" label="Pattern finder" />
          <SplitBlock
            label="End-of-week decision"
            title="Speed alone does not win"
            left={{ eyebrow: "Keep", title: "The work improved", body: "The measure moved in the right direction without a meaningful loss of safety, accuracy, accessibility, or quality." }}
            right={{ eyebrow: "Stop or revise", title: "The cost moved elsewhere", body: "The change created errors, hidden work, frustration, weaker controls, or a problem for someone else." }}
          />
          <ChecklistBlock article={article} title="Your experiment is fair when…" label="Before day one" />
          <WhyBlock article={article} title="Why small experiments work" />
          <SafetyBlock article={article} title="Keep the guardrails" />
          <ImproveBlock article={article} label="Build your experiment log" />
        </>
      );
  }
}

export default function GuidesLibrary() {
  const articles = useMemo(() => guideSeries.flatMap((series) => series.articles.map((article) => ({ ...article, series: series.title }))), []);
  const [activeSlug, setActiveSlug] = useState(articles[0]?.slug ?? "");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const active = articles.find((article) => article.slug === activeSlug) ?? articles[0];

  if (!active) return null;

  const activeIndex = articles.indexOf(active);
  const next = articles[(activeIndex + 1) % articles.length];

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(active.prompt);
      setCopiedSlug(active.slug);
      window.setTimeout(() => setCopiedSlug(null), 1800);
    } catch {
      setCopiedSlug(null);
    }
  }

  function selectGuide(slug: string) {
    setActiveSlug(slug);
    setCopiedSlug(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className={styles.library} data-format={active.format}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/clearstep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
        </Link>
        <div className={styles.libraryLabel}><span>Guides</span><strong>Practical AI, minus the noise.</strong></div>
        <nav aria-label="Guide library">
          {guideSeries.map((series, seriesIndex) => (
            <section className={styles.navSeries} key={series.slug}>
              <p><span>0{seriesIndex + 1}</span>{series.title}</p>
              {series.articles.map((article) => (
                <button className={article.slug === active.slug ? styles.activeGuide : styles.guideLink} key={article.slug} type="button" onClick={() => selectGuide(article.slug)}>
                  <small>{article.formatLabel}</small>
                  {article.title}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <Link className={styles.exitLink} href="/account">← Back to your account</Link>
      </aside>

      <article className={styles.article}>
        <header className={styles.articleHeader}>
          <div className={styles.headerMeta}>
            <p className={styles.breadcrumb}>{active.series} <span>/</span> Guide {String(activeIndex + 1).padStart(2, "0")}</p>
            <p className={styles.formatBadge}>{active.formatLabel}</p>
          </div>
          <h1>{active.title}</h1>
          <p className={styles.dek}>{active.summary}</p>
          <dl className={styles.quickRead}>
            <div><dt>Time</dt><dd>{active.time}</dd></div>
            <div><dt>Level</dt><dd>{active.level}</dd></div>
            <div><dt>You’ll make</dt><dd>{active.outcome}</dd></div>
          </dl>
          <details className={styles.startDetails}>
            <summary>What you need</summary>
            <div><strong>Bring</strong><ul>{active.prerequisites.map((item: string) => <li key={item}>{item}</li>)}</ul></div>
            <div><strong>Tools</strong><p>{active.tools.join(", ")}</p></div>
          </details>
        </header>

        <GuideBody article={active} copied={copiedSlug === active.slug} onCopy={() => void copyPrompt()} />

        <footer className={styles.articleFooter}>
          <p><span>Next format: {next.formatLabel}</span><strong>{next.title}</strong></p>
          <button type="button" onClick={() => selectGuide(next.slug)}>Continue →</button>
        </footer>
      </article>
    </main>
  );
}
