import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("exports the BNC Consulting service gateway", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>BNC Consulting \| Clearstep AI and Plate &amp; Post<\/title>/i);
  assert.match(html, /One business\.[\s\S]*Two focused service lines\./i);
  assert.match(html, /href="\/clearstep\/?"/i);
  assert.match(html, /href="\/plate-and-post\/?"/i);
  assert.match(html, /https:\/\/www\.bncconsulting\.nl/);
  assert.doesNotMatch(html, /https:\/\/www\.clearstep-ai\.nl|http:\/\/localhost:3000/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("exports the branded Clearstep home under its service route", async () => {
  const html = await readFile(new URL("../out/clearstep/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Practical AI workshops for small businesses \| Clearstep AI<\/title>/i);
  assert.match(html, /Make AI useful\./);
  assert.match(html, /Keep it simple\./);
  assert.match(html, /primary-logo\.png/);
  assert.match(html, /https:\/\/www\.bncconsulting\.nl\/clearstep/);
  assert.doesNotMatch(html, /http:\/\/localhost:3000/);
  assert.match(html, /Find a workshop/);
  assert.match(html, /Plan a private session/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the public type scale compact and light surfaces readable", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/clearstep/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /body\s*\{[^}]*font-size:\s*17px/su);
  assert.match(styles, /h1\s*\{[^}]*clamp\(44px,\s*6vw,\s*70px\)/su);
  assert.match(styles, /\.empty-state\s*\{\s*color:\s*var\(--color-text\);\s*\}/u);
  assert.match(styles, /\.empty-state p\s*\{\s*color:\s*var\(--color-text-muted\);\s*\}/u);
  assert.match(styles, /\.workshop-preview \.empty-state \.text-link\s*\{\s*color:\s*var\(--color-action\);\s*\}/u);
  assert.match(styles, /\.hero-copy\s*\{\s*min-width:\s*0;\s*\}/u);
  assert.match(page, /className="empty-state [^"]*bg-white/u);
});

test("deploys the validated static export through Cloudflare Pages", async () => {
  const [nextConfig, workflow, headers] = await Promise.all([
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../out/_headers", import.meta.url), "utf8"),
  ]);

  assert.match(nextConfig, /output:\s*"export"/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /actions\/download-artifact@v5/u);
  assert.match(workflow, /cloudflare\/wrangler-action@v3/u);
  assert.match(workflow, /needs:\s*\[build, supabase-integration\]/u);
  assert.equal(workflow.match(/name:\s*cloudflare-pages-site/gu)?.length, 2);
  assert.match(workflow, /pages deploy out --project-name=\$\{\{ vars\.CLOUDFLARE_PAGES_PROJECT_NAME \}\} --branch=main/u);
  assert.match(workflow, /apiToken:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
  assert.match(workflow, /accountId:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/u);
  assert.match(workflow, /NEXT_PUBLIC_SITE_URL:\s*https:\/\/www\.bncconsulting\.nl/u);
  assert.match(workflow, /github\.event_name != 'pull_request'/u);
  assert.match(workflow, /path:\s*out/u);
  assert.doesNotMatch(workflow, /actions\/(?:configure|deploy)-pages|upload-pages-artifact|pages:\s*write|id-token:\s*write/u);

  assert.match(headers, /Content-Security-Policy:\s*default-src 'self'/u);
  assert.match(headers, /frame-ancestors 'none'/u);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/u);
  assert.match(headers, /X-Frame-Options:\s*DENY/u);
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/u);
  assert.match(headers, /Permissions-Policy:\s*camera=\(\), geolocation=\(\), microphone=\(\)/u);
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*[\s\S]*X-Robots-Tag:\s*noindex, nofollow/u);
  assert.match(headers, /https:\/\/:branch\.:project\.pages\.dev\/\*[\s\S]*X-Robots-Tag:\s*noindex, nofollow/u);
});

test("documents service-aware redirects outside the static Pages artifact", async () => {
  const runbook = await readFile(new URL("../docs/cloudflare-pages-runbook.md", import.meta.url), "utf8");
  const marketingRule = "concat(\"https://www.bncconsulting.nl/clearstep\", http.request.uri.path)";
  const sharedPathRule = "concat(\"https://www.bncconsulting.nl\", http.request.uri.path)";
  const marketingHeading = "### Old Clearstep marketing paths";
  const sharedHeading = "### Old Clearstep shared paths";
  const unknownHeading = "### Old Clearstep unknown paths";
  const sharedStart = runbook.indexOf(sharedHeading);
  const unknownStart = runbook.indexOf(unknownHeading);
  const sharedSection = runbook.slice(sharedStart, unknownStart);
  const unknownSection = runbook.slice(unknownStart, runbook.indexOf("## 6. Verify", unknownStart));

  assert.match(runbook, /http\.request\.uri\.path eq "\/"[\s\S]*https:\/\/www\.bncconsulting\.nl\/clearstep\//u);
  assert.ok(runbook.includes(marketingRule));
  assert.ok(runbook.indexOf(marketingHeading) < sharedStart);
  assert.ok(sharedStart < unknownStart);
  assert.ok(sharedSection.includes(sharedPathRule));
  assert.match(sharedSection, /http\.request\.uri\.path in \{[^}]*"\/privacy\/"[^}]*\}/u);
  assert.match(sharedSection, /starts_with\(http\.request\.uri\.path, "\/account\/"\)[\s\S]*starts_with\(http\.request\.uri\.path, "\/auth\/"\)/u);
  assert.match(unknownSection, /http\.request\.uri\.path ne "\/"[\s\S]*Static target: `https:\/\/www\.bncconsulting\.nl\/clearstep\/`/u);
  assert.doesNotMatch(unknownSection, /concat\("https:\/\/www\.bncconsulting\.nl", http\.request\.uri\.path\)/u);
  assert.match(runbook, /Cloudflare Pages `_redirects` does not support domain-level source matching/u);
  assert.match(runbook, /Preserve query string: enabled/u);
  assert.match(runbook, /HTTP redirect cannot transfer a Supabase session or PKCE verifier/u);
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
