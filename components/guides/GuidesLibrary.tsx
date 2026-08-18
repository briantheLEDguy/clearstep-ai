"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { guideSeries } from "@/lib/guides";

import styles from "./guides.module.css";

export default function GuidesLibrary() {
  const articles = useMemo(() => guideSeries.flatMap((series) => series.articles.map((article) => ({ ...article, series: series.title }))), []);
  const [activeSlug, setActiveSlug] = useState(articles[0]?.slug ?? "");
  const active = articles.find((article) => article.slug === activeSlug) ?? articles[0];

  if (!active) return null;

  return (
    <main className={styles.library}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/primary-logo.png" alt="Clearstep AI" width="200" height="53" />
        </Link>
        <div className={styles.libraryLabel}><span>Guides</span><strong>Practical AI, minus the noise.</strong></div>
        <nav aria-label="Guide library">
          {guideSeries.map((series, seriesIndex) => (
            <section className={styles.navSeries} key={series.slug}>
              <p><span>0{seriesIndex + 1}</span>{series.title}</p>
              {series.articles.map((article) => (
                <button className={article.slug === active.slug ? styles.activeGuide : styles.guideLink} key={article.slug} type="button" onClick={() => { setActiveSlug(article.slug); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
          <p className={styles.breadcrumb}>{active.series} <span>/</span> Guide {String(articles.indexOf(active) + 1).padStart(2, "0")}</p>
          <h1>{active.title}</h1>
          <p className={styles.dek}>{active.summary}</p>
          <dl className={styles.quickRead}>
            <div><dt>Time</dt><dd>{active.time}</dd></div>
            <div><dt>Level</dt><dd>{active.level}</dd></div>
            <div><dt>You’ll make</dt><dd>{active.outcome}</dd></div>
          </dl>
        </header>

        <section className={styles.why}><p className={styles.sectionLabel}>Why this works</p><p>{active.why}</p></section>

        <section className={styles.steps}>
          <p className={styles.sectionLabel}>Step by step</p>
          {active.steps.map((step, index) => (
            <div className={styles.step} key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h2>{step.title}</h2><p>{step.body}</p>{step.tip ? <p className={styles.tip}><strong>Quick tip</strong>{step.tip}</p> : null}</div>
            </div>
          ))}
        </section>

        <section className={styles.promptBlock}>
          <div><p className={styles.sectionLabel}>Copy this</p><span>Works in {active.tools.join(", ")}</span></div>
          <pre><code>{active.prompt}</code></pre>
        </section>

        <section className={styles.checklist}>
          <p className={styles.sectionLabel}>Check your result</p>
          <h2>Before you call it done</h2>
          <ul>{active.checks.map((check) => <li key={check}>{check}</li>)}</ul>
        </section>

        <aside className={styles.safety}><strong>Keep it safe</strong><p>{active.safety}</p></aside>

        <footer className={styles.articleFooter}>
          <p><span>Next guide</span><strong>{articles[(articles.indexOf(active) + 1) % articles.length].title}</strong></p>
          <button type="button" onClick={() => setActiveSlug(articles[(articles.indexOf(active) + 1) % articles.length].slug)}>Continue →</button>
        </footer>
      </article>
    </main>
  );
}
