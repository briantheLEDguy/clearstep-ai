import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("exports the branded Clearstep home page", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Practical AI workshops for small businesses \| Clearstep AI<\/title>/i);
  assert.match(html, /Make AI useful\./);
  assert.match(html, /Keep it simple\./);
  assert.match(html, /primary-logo\.png/);
  assert.match(html, /https:\/\/www\.clearstep-ai\.nl/);
  assert.doesNotMatch(html, /http:\/\/localhost:3000/);
  assert.match(html, /Find a workshop/);
  assert.match(html, /Plan a private session/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the public type scale compact and light surfaces readable", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /body\s*\{[^}]*font-size:\s*17px/su);
  assert.match(styles, /h1\s*\{[^}]*clamp\(44px,\s*6vw,\s*70px\)/su);
  assert.match(styles, /\.empty-state\s*\{\s*color:\s*var\(--navy\);\s*\}/u);
  assert.match(styles, /\.empty-state p\s*\{\s*color:\s*var\(--text-muted\);\s*\}/u);
  assert.match(styles, /\.workshop-preview \.empty-state \.text-link\s*\{\s*color:\s*var\(--action\);\s*\}/u);
  assert.match(styles, /\.hero-copy\s*\{\s*min-width:\s*0;\s*\}/u);
  assert.match(page, /className="empty-state [^"]*bg-white/u);
});

test("configures a GitHub Pages static export", async () => {
  const [nextConfig, workflow] = await Promise.all([
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  ]);

  assert.match(nextConfig, /output:\s*"export"/u);
  assert.match(workflow, /actions\/configure-pages@v6/u);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/u);
  assert.match(workflow, /actions\/deploy-pages@v5/u);
  assert.match(workflow, /pages:\s*write/u);
  assert.match(workflow, /path:\s*out/u);
});

test("removes all disposable starter-preview code", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
