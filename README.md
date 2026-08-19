# Clearstep AI

Clearstep AI is a static Next.js workshop catalogue with Supabase-backed authentication, bookings, staff operations, consent-gated first-party analytics, and provider automation. Its public message is **“Make AI useful. Keep it simple.”**

## Status

This repository is an acceptance-stage implementation. A green frontend build is not evidence that payments, providers, legal content, accessibility, or production security are ready for public sale. Treat the release checklist below as a gate, not as an optional follow-up.

The public site is exported to GitHub Pages. Supabase is the authoritative runtime for identity, catalogue availability, holds, enrollments, payments, waitlists, staff roles, automation, and consented analytics. Published workshop URLs are session-specific: `/workshops/[course-slug]--[session-id]`.

## Architecture

```text
GitHub Pages / Next.js static export
  ├─ public pages, metadata, sitemap, and noindex account routes
  └─ browser client using only a Supabase publishable key
       ├─ Supabase Auth and RLS-protected reads
       ├─ Edge Functions for privileged and provider-facing actions
       └─ Postgres, PGMQ, cron, Vault, and provider integrations
```

| Area | Responsibility |
| --- | --- |
| `app/` | Next.js routes, metadata, sitemap, robots, and public/legal pages |
| `components/` | Accessible UI and browser-side Supabase interactions |
| `lib/` | Catalogue validation, shared client helpers, and view models |
| `supabase/migrations/` | Append-only database schema, RLS, RPC, queue, and retention history |
| `supabase/functions/` | Edge Functions and shared provider/security helpers |
| `supabase/tests/` | Static contracts and disposable local-database integration checks |
| `tests/` | Frontend, rendered-export, and browser accessibility contracts |
| `shared/` | Server-authoritative customer legal-document versions |
| `scripts/` | Release and configuration validation helpers |
| `docs/` | Governance and release-review guidance |

## Local development

Use Node.js `>=22.13.0`.

1. Install locked dependencies with `npm ci`.
2. Copy the root environment template to `.env.local` and supply the public build values required for the page you are working on. Do not commit `.env.local`.
3. Run `npm run dev`.
4. Before handing off a change, run the checks below.

```text
npm run lint
npm run typecheck
npm test
npm run test:a11y
```

`npm test` builds the static export first, then runs the repository’s source and rendered-output contracts. `npm run test:a11y` performs a self-contained static build with a local intercepted Supabase endpoint, so Playwright can prove that browser analytics does not contact production. When Docker is available, also run `npm run test:db`; it starts a disposable local Supabase stack and applies every migration before its pgTAP assertions. None of these replace Stripe, Google, or production-provider acceptance testing.

## Configuration boundaries

The root `.env.example` is the project’s build/release configuration reference. Only variables prefixed `NEXT_PUBLIC_` can appear in the browser or GitHub Pages build; a publishable Supabase key is intentionally public, but service-role and provider credentials are not.

`supabase/.env.example` is the local Edge Function template. Production Edge Function values belong in Supabase secret management, never in a Pages variable, frontend bundle, test fixture, issue, or log. The Edge runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; do not add those credentials to either example file.

Important Edge Function secret names are documented in [the Supabase runbook](supabase/README.md). They include payment, webhook, OAuth, email-hook, rate-limit, and public-site configuration. Use separate test and live provider credentials.

Public company contact and complaints information is static page copy rather than browser configuration. Keep it factual and update its source of truth with the public policy pages; it is not a build-time release signal.

## Deployment and operations

`.github/workflows/pages.yml` runs lint, type checks, static contracts, Chromium/Axe accessibility checks, and a disposable Supabase migration/RLS integration suite for `main`, manual dispatch, pull requests, and the hourly catalogue refresh. It uses public Supabase build variables only. It does not deploy or attest the production Edge Function bundle, so the release owner must verify that customer-facing policy text and the matching checkout Function document version are deployed together. GitHub Pages is not an authorization boundary: all private and administrative access must remain enforced by Supabase Auth, RLS, and Edge Function authorization.

GitHub Pages cannot provide application-defined response headers such as a deploy-specific CSP. The production hosting/security-header posture remains an explicit release decision; do not describe it as remediated merely because the static app builds.

The static catalogue is rebuilt on the scheduled deployment. Checkout, availability, and enrollment are still decided by the authoritative backend at the time of the request; browser prices and completion-page visits do not create enrollments.

Read [supabase/README.md](supabase/README.md) before applying migrations, deploying functions, configuring secrets, or connecting Stripe and Google Workspace.

## Security, accessibility, and compliance

- [SECURITY.md](SECURITY.md) explains responsible vulnerability reporting and the supported security boundary.
- [Compliance and accessibility release guide](docs/compliance-accessibility.md) is the evidence checklist for privacy, accessibility, and release review. It is not a legal certification.
- [AGENTS.md](AGENTS.md) defines the standard maintenance, audit, documentation, and GitHub-issue practice for contributors and coding agents.

## Release gate

Do not enable public sales until the release owner has recorded evidence that all applicable items are complete:

- Database migrations, RLS policies, Edge Functions, and their JWT modes are deployed to the intended Supabase project and tested with real role boundaries.
- Stripe test and live configuration, payment methods, VAT/tax treatment, invoices, refunds, duplicate/out-of-order webhooks, expiries, and remediation paths are verified without using production customer data.
- Student Auth, Workspace OAuth, Gmail/Calendar automation, worker invocation, and the Auth email hook are configured and failure paths are tested.
- The analytics opt-in, policy-version renewal, withdrawal/raw-event deletion, and pre-consent no-collection paths are verified.
- The Chromium/Axe checks, mobile reflow check, keyboard/dialog flow, and manual NVDA/Firefox and VoiceOver/Safari evidence in `docs/compliance-accessibility.md` are current.
- The public company contact, complaints procedure, customer-facing policy text, provider agreements, data-processing roles/transfers, retention, and rights-request process have been reviewed against the actual operating model; a static page or successful build is not evidence that they are complete.
- The versioned Terms and Cancellation policy shown to a buyer match the server-recorded checkout acknowledgement, and authenticated data/cancellation requests are tested as staff-reviewed intake rather than automatic fulfilment.
- The static policy pages and deployed checkout Edge Function are evidenced as the same document-version release; do not infer that parity from the Pages workflow alone.
- The site has passed the accessibility and responsive/manual review recorded in `docs/compliance-accessibility.md`.
- No known high-severity security issue, secret exposure, or unresolved release-blocking ticket remains.

## Keeping this repository current

Update this README when the architecture, setup, release process, or verification commands change. Update `supabase/README.md` with backend and deployment changes, `changelog.md` with user- or operator-visible changes, and the compliance guide when the data flow or accessibility process changes. Keep historical migrations immutable; add a new migration for database changes.
