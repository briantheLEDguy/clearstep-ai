# Clearstep AI

Clearstep AI is a branded, SEO-focused workshop catalogue, booking platform, student account area, and protected staff workspace. Its public message is **“Make AI useful. Keep it simple.”**

This repository is an acceptance-stage implementation targeting Supabase project `besjkfgfhraibrlaiejk`. The site is built as a static Next.js export and deployed by GitHub Actions to GitHub Pages. Supabase remains the runtime system for identity, catalogue data, booking operations, staff access, analytics, and provider automation. The production Auth Site URL and exact callback allowlist use `https://www.clearstep-ai.nl`. The Stripe sandbox has a rotated server key, three matching draft Product/Price pairs, and a signed webhook that passed a non-payment health probe. The exact secondary `Clearstep Workshops` calendar, Workspace identity, callback, owner notification address, analytics abuse salt, and disabled automatic-tax flag are configured in Supabase; the Google OAuth client and owner authorization are not. The seed remains deliberately draft and unsellable. Stripe account activation, provider acceptance, worker invocation, and public launch remain gated.

## Architecture

```text
GitHub Pages / Next.js static export
  ├─ prerendered public catalogue and metadata
  ├─ authenticated student and staff interfaces
  └─ Supabase client using only the publishable key
       ├─ Auth: magic links and student Google login
       ├─ Postgres: RLS-protected public data and private operational data
       ├─ Edge Functions: Stripe, staff, analytics, Google and email APIs
       └─ PGMQ + cron: durable booking and automation work
```

Supabase is authoritative for catalogue availability, identity, capacity, holds, enrollments, payments, waitlists, staff roles, automation state, and analytics. GitHub Actions loads the sanitized `public_workshop_catalog()` RPC while producing the static Pages artifact; an hourly scheduled workflow refreshes published workshop pages. Each published session receives an immutable `/workshops/[course-slug]--[session-id]` URL. Money is integer EUR cents; database times are UTC `timestamptz` and display primarily in `Europe/Amsterdam`.

The protected Guides library keeps article content and editorial-format metadata in `lib/guides.ts`. `components/guides/GuidesLibrary.tsx` renders nine subject-specific reading modes—including labs, audits, timelines, canvases, and runbooks—through one accessible library shell. The project-local `.codex/skills/technical-guide-writer` skill defines the writing and safety standard for future guide work.

## Routes

Indexable public routes:

- `/`
- `/workshops` and `/workshops/[course-slug]--[session-id]`
- `/private-workshops`
- `/about`, `/faq`
- `/privacy`, `/terms`, `/cancellation`

Identity and noindex routes:

- `/sign-in`, `/auth/callback`
- `/account`, `/account/bookings`, `/account/waitlist`, `/account/private-quote`
- `/guides` (confirmed customers and staff)
- `/checkout/success`, `/checkout/cancel`
- `/staff/invite`
- `/admin`

The application supplies canonical metadata, sitemap/robots rules, Open Graph data, and Organization, Course, Event, and breadcrumb structured data. Account, invitation, checkout-result, and staff routes are excluded from indexing.

## Authentication and staff access

Checkout requires Supabase Auth with email magic links or student Google login. Student Google identity uses a separate public OAuth client from Workspace automation.

- `owner`: all operations, team access, roles, and integrations
- `admin`: workshops, bookings, waitlists, private requests/quotes, and analytics
- `analyst`: `analytics_summary` plus the caller’s own staff context only

`brian@bncconsulting.co` is the verified bootstrap owner. Other staff enter through a seven-day, single-use invitation accepted while signed in with the invited verified email. Only a token hash is stored in the invitation record. Raw delivery links are removed from completed automation payloads and have expiry-based/31-day fallback redaction.

Signed-in owners and admins receive an **Admin** link in the public site navigation. The staff workspace supports audited price replacement through Stripe, full session detail/edit controls from the overview schedule, and owner-only cancellation of pending automation jobs or reruns of terminal non-email jobs. Email reruns remain restricted to the verified-unsent reconciliation flow to prevent duplicate messages.

## Local setup

Use Node.js `>=22.13.0`.

```text
npm install
npm run dev
npm run lint
npx tsc --noEmit --incremental false
npm test
```

Copy `.env.example` to `.env.local` for local development. Do not commit secrets.

Browser and GitHub Actions repository variable names:

```text
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Supabase Edge Function secret names:

```text
PUBLIC_SITE_URL
ADMIN_NOTIFICATION_EMAIL
RATE_LIMIT_HASH_SALT
STRIPE_API_KEY
STRIPE_WEBHOOK_SIGNING_SECRET
STRIPE_AUTOMATIC_TAX_ENABLED
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_WORKSPACE_EMAIL
GOOGLE_WORKSPACE_DOMAIN
GOOGLE_CALENDAR_ID
SEND_EMAIL_HOOK_SECRET
```

The Edge runtime provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Never expose a secret or service-role credential through a `NEXT_PUBLIC_` variable.

## Supabase and provider operations

Review and apply the eight migrations in lexical order, deploy the twelve functions with `supabase/config.toml`, and set runtime secrets only in the verified `besjkfgfhraibrlaiejk` project. The runtime hardening migration moves Workspace OAuth tokens to Supabase Vault, adds the public analytics throttle, protects Gmail delivery intents, serializes Calendar work per session, caps quote checkout, and redacts sensitive delivery payloads. The later admin-controls migration adds service-only price and queue operations. See `supabase/README.md` for the exact inventory and runbook.

Stripe Checkout uses stored VAT-inclusive EUR Prices, invoices, dynamic payment methods, and a verified raw-body webhook. The browser never supplies an amount. A Checkout Session must fit Stripe’s minimum window and may not outlive its database hold, private-quote deadline, or workshop start. Enrollment is webhook-owned; success-page visits are read-only. Unsettled asynchronous payments time out after their authoritative grace window, release the provisional seat, and alert the customer and Brian. A later paid event still enters final capacity/post-start checks. Late payments that cannot be allocated are persisted as refund remediation and keep integration health degraded until resolved.

Admin price edits create a new immutable, VAT-inclusive one-time EUR Price on the course’s existing Stripe Product, validate it server-side, and then update the authoritative course record. Existing Checkout Sessions and payments keep their original amount. The restricted Stripe key therefore also needs permission to create Prices.

Workspace automation uses a dedicated **Clearstep Workshops** calendar. Sessions are provisioned before sale; online/hybrid sessions are not ready until Meet creation returns a URL. Per-session leases serialize attendee changes, every job rebuilds mutable event fields from current database state, and each online transition derives a new Meet request ID from the session revision while retries of that transition reuse it. If Google marks creation as failed, the provider request fingerprint derives the next stable recovery ID. A change to in-person explicitly clears conference data and the stored Meet URL. Full refunds remove only the refunded attendee, while stale add jobs check current enrollment status. Gmail outbox delivery uses a durable send intent and deterministic RFC Message-ID. Explicit 401 responses refresh authorization and retry once; rejected 429/5xx requests use queue backoff. An ambiguous transport/post-send failure is marked `uncertain` instead of being automatically resent, and the owner must check Gmail before confirming delivery or explicitly retrying a verified-unsent message.

PGMQ is the durable transport. `private.automation_jobs` supplies logical deduplication, status, attempts, and operator visibility; `pgmq.read`, `set_vt`, and `archive` supply claim/retry/archive behavior. Cron handles booking maintenance, analytics retention, runtime-security cleanup, and—after separate Vault/`pg_net` setup—the worker invocation.

Analytics is first-party and cookie-free. The public endpoint accepts only its explicit event and per-event property allowlists; browser-supplied transaction identifiers and arbitrary properties are rejected. `checkout_started`, enrollments, revenue, refunds, and operational failures are server-authoritative. A ten-minute HMAC abuse key is kept only in a private rate-limit table and is never written to an analytics row. No raw IP or user agent is retained. Raw events are kept 90 days and daily aggregates 24 months.

## Production Auth and Google callback

In Supabase Authentication → URL Configuration:

1. Set **Site URL** to `https://www.clearstep-ai.nl`.
2. Add `https://www.clearstep-ai.nl/auth/callback` to **Redirect URLs**.
3. Keep local callback URLs only for local development.

Configure the student Google provider with the Supabase Auth callback for project `besjkfgfhraibrlaiejk` and identity-only scopes. Configure Workspace automation separately with the deployed `google-oauth-callback` Edge Function URL, offline access, Gmail-send, and Calendar-events scopes. The application returns the owner to the `/admin#integrations` panel, with a status query parameter. Enable the branded Auth Send Email Hook only after owner bootstrap and verified Gmail sending.

## GitHub Pages release

The workflow in `.github/workflows/pages.yml` tests and exports the site on every push to `main`, on manual dispatch, and hourly for catalogue refreshes. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables. Pages uses `www.clearstep-ai.nl` as its custom domain; the DNS `CNAME` must point directly to `briantheLEDguy.github.io`.

GitHub Pages cannot add application-defined HTTP response headers. The previous worker-level CSP, `X-Frame-Options`, and related headers therefore do not carry over. Do not treat static hosting as a privileged security boundary: Supabase RLS, verified Auth identities, and Edge Function authorization remain mandatory for every private or administrative operation.

Do not publish publicly until all of these gates are complete:

- Configure remote secrets, install the worker invocation cron, and execute database/provider integration tests. Supabase advisors were run after migration; only intentional private-table/RPC notices and fresh-database unused-index notices remained.
- Complete the Stripe sandbox business requirements and terms so payments become enabled; then verify cards/iDEAL, invoices, VAT/tax behavior, refunds, and the separate live-mode key, webhook, and Product/Price set.
- Configure separate student and Workspace OAuth clients, connect Brian’s Workspace account, create the dedicated calendar, and test Gmail/Calendar failures and uncertain-email reconciliation.
- Configure the student Google provider, standard email bootstrap, and the Auth Send Email Hook; then verify both production Auth callback paths end to end.
- Complete provider-backed competition, expiry, duplicate/out-of-order webhook, refund, RLS, invitation, rate-limit, retention, and integration-health tests.
- Approve the legal entity, VAT details, privacy/terms/cancellation/refund wording, custom domain, and trademark/domain clearance.
- Replace Canva preview artwork with approved full-resolution logo and brand exports.
- Complete a production Pages acceptance review and receive explicit approval for public release.
