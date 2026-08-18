# Clearstep Supabase backend

This directory contains the database, Auth integration points, Edge Functions, Stripe workflow, Google Workspace automation, staff authorization, and first-party analytics for Clearstep. The remote project is `besjkfgfhraibrlaiejk` (**Clearstep** in the **AI-workshop** organization). The original seven migrations and twelve Edge Functions were applied/deployed there on 2026-08-18 and verified active; `20260818200414_admin_controls.sql` and its updated `admin-catalog` function must be deployed with the matching frontend release. Provider secrets and OAuth/payment connections are not yet live; verify the selected project before every future migration, secret, function, or cron operation.

## Data and authorization boundaries

The exposed `public` schema contains profiles, published courses/sessions, each student’s own enrollments and waitlist entries, plus deliberately granted RPCs. RLS is enabled on every exposed table. Anonymous users receive only the sanitized published catalogue; authenticated students receive only their own customer records.

The unexposed `private` schema contains holds, checkout/payment/webhook records, waitlist offers, private requests/quotes, staff and hashed invitations, Google state/Vault references, Calendar/Meet state, PGMQ job metadata, email delivery intents, integration health, analytics, abuse controls, and audit history. Privileged Edge operations use service-only `security definer` RPCs with an empty search path and explicit execute revocation from `PUBLIC`, `anon`, and `authenticated`.

Roles:

- `owner`: all operations, team/role management, and integrations
- `admin`: catalogue, sessions, bookings, waitlists, private requests/quotes, and analytics
- `analyst`: `analytics_summary` and the caller’s own `staff_context` only

The verified bootstrap owner is `brian@bncconsulting.co`. Staff invitations are single-use, expire after seven days, store a token hash only, and must be accepted by the invited verified email.

## Migration order

Apply exactly in lexical order:

1. `20260818130000_clearstep_core.sql` — schemas, core records, constraints, indexes, RLS/grants, owner bootstrap
2. `20260818130050_operations_schema.sql` — PGMQ, payment/delivery/health/audit records, catalogue/account RPCs, analytics rollup/retention
3. `20260818130100_booking_workflows.sql` — atomic checkout, waitlist/private requests, Stripe/refund/remediation workflows
4. `20260818130200_admin_analytics_automation.sql` — staff, Google state, administration, analytics, maintenance, PGMQ worker RPCs
5. `20260818130300_booking_maintenance_cron.sql` — minute booking maintenance
6. `20260818130400_seed_clearstep_catalog.sql` — fixed catalogue/session seed with Stripe IDs intentionally `null`
7. `20260818130500_runtime_security_hardening.sql` — Vault tokens, analytics throttle, Stripe failure attempts, Gmail send intent, Calendar leases/refund removal, quote expiry, sensitive-payload cleanup
8. `20260818200414_admin_controls.sql` — audited course price replacement and owner-only automation cancellation/reruns

Migration seven intentionally invalidates any legacy app-encrypted Google connection; the owner must authorize Workspace again so fresh access and refresh tokens are created directly in Supabase Vault.

## Edge Functions

JWT modes are declared in `config.toml`.

| Function | Control | Responsibility |
| --- | --- | --- |
| `create-checkout` | authenticated user | Atomic hold and Stripe Checkout for public, waitlist-offer, or verified private-quote purchase |
| `stripe-webhook` | public, raw Stripe signature | Idempotent lifecycle/refund processing, durable failure attempts, remediation health |
| `join-waitlist` | authenticated user | FIFO entry when no public seat is available |
| `private-workshop-request` | public validation, honeypot, timing/rate controls | Store request and queue customer/owner mail |
| `admin-catalog` | authenticated, action-level role checks | Catalogue, sessions, bookings, quotes, waitlist, analytics, team, audit, queue, health |
| `staff-invite` | owner | Create and queue a seven-day invitation |
| `staff-invite-accept` | invited authenticated email | Validate and consume invitation |
| `google-oauth-start` | owner | Signed, PKCE, offline Workspace authorization start |
| `google-oauth-callback` | public signed state callback | Validate identity and store tokens in Vault |
| `automation-worker` | secret API key | Process Gmail and Calendar work from PGMQ |
| `analytics-ingest` | public validation and private DB rate limit | Accept explicit privacy-first browser events |
| `auth-send-email-hook` | Standard Webhooks signature | Send branded Supabase Auth mail with Gmail |

Workspace OAuth returns to the `/admin#integrations` panel with a `google=connected` or `google=error` query value.

## Environment and secret names

Set values with Supabase secret management; never commit them.

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

The Edge runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## Production setup order

1. Verify project reference `besjkfgfhraibrlaiejk`; review and apply the eight migrations in order with PGMQ, `pg_cron`, Vault, and `pg_net` available.
2. Deploy all functions with the JWT modes in `config.toml`; set the secret names above.
3. Configure production Supabase Auth URLs and bootstrap Brian’s verified owner before enabling the custom email hook.
4. Configure Stripe test Products/Prices and the signed webhook; keep live IDs unset until payment/tax acceptance passes.
5. Configure the internal Workspace OAuth client, authorize Brian, and provision the dedicated calendar.
6. Store the worker endpoint/key in Vault and run `cron/enable_automation_worker.sql`; never place real values in that source file.
7. Enable the Auth Send Email Hook only after Gmail is verified.
8. Run database/provider tests, Supabase advisors, migration review, and a secret scan before private acceptance.

### Production Auth configuration

In Authentication → URL Configuration:

- set **Site URL** to `https://www.clearstep-ai.nl`;
- add `https://www.clearstep-ai.nl/auth/callback` to **Redirect URLs**;
- keep local callback URLs only in development.

Student Google login uses a separate public client and the Supabase Auth callback for `besjkfgfhraibrlaiejk`, with identity-only scopes. Workspace automation uses the deployed `google-oauth-callback` Edge URL, offline access, and only Gmail-send/Calendar-events scopes. The Auth hook builds Supabase `/auth/v1/verify` links that return only to Clearstep’s same-origin `/auth/callback`.

## Stripe invariants

Checkout validates the stored active Product and VAT-inclusive EUR Price and never trusts browser money. A private quote is user/email/token bound. The database hold, Stripe expiry, private-quote deadline, and session-start cutoff must agree; a checkout is rejected when Stripe’s safe 30-minute minimum cannot fit.

Configure these webhook events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`

The restricted key needs read Products/Prices, create Prices, create/retrieve/expire Checkout Sessions, and permissions needed by invoices/receipts. Admin amount changes create a replacement one-time EUR Price on the existing Product and validate its amount, active state, Product, and inclusive tax behavior before the course record changes; existing purchases are untouched. Webhook enrollment is authoritative. Duplicate/out-of-order events are idempotent. A verified processing exception is recorded in `private.stripe_webhook_failures` without consuming the event ID needed for Stripe retry. Unsettled asynchronous payments time out after their grace deadline, cancel the provisional enrollment, release the hold/offer, and queue customer/owner notices; any later paid event still runs final allocation/remediation. Late/post-cutoff payments that cannot receive a seat remain refund-remediation records and degrade health; they are not silently acknowledged as healthy.

## Google and automation invariants

Create a dedicated **Clearstep Workshops** calendar and set `GOOGLE_CALENDAR_ID`; there is no primary-calendar fallback. OAuth tokens live only in Vault. Events disable guest-list visibility, guest invitations, and guest edits.

Public/private sessions must have a Calendar event before sale. Online/hybrid sessions become ready only after Google Meet supplies a URL; pending/absent conference creation is polled with a request ID derived from the current session revision. That ID is stable across retries of one transition and changes after a later in-person-to-online transition. A provider-declared creation failure derives the next stable recovery ID from the failed request fingerprint. A per-session lease serializes writes, and the worker resolves the current course/session fields at execution instead of trusting historical job payloads. Moving a session to in-person explicitly clears Google conference data and writes a `null` Meet URL without coalescing the old value. Full refunds enqueue `calendar_enrollment_remove`, which filters only the refunded attendee under an ETag and is idempotent; partial refunds do not enqueue removal. A stale add checks the enrollment is still confirmed.

PGMQ is the transport; `private.automation_jobs` stores dedupe/status/attempt metadata. Gmail has no request idempotency key, so email work records a durable intent before send and a deterministic RFC Message-ID. Explicit 401 rejection refreshes the token and retries once; rejected 429/5xx requests use queue backoff. Any ambiguous transport/post-send interruption becomes terminal `uncertain`, preventing automatic duplicates. The owner queue view requires a deliberate, audited choice after checking Gmail: confirm the message was sent or retry only after verifying it was not sent. Completed/cancelled delivery payloads redact invitation, waitlist, and quote action data immediately. Failed/uncertain payloads remain only for recovery and are redacted when their action expires or after at most 31 days.

Owners may cancel only jobs that are still pending; the queue message is archived before the database job becomes `cancelled`. Failed, completed, or cancelled non-email jobs may be rerun from the beginning with a fresh queue message. Processing jobs cannot be cancelled, and completed/cancelled email jobs cannot be rerun, because either action could duplicate an external side effect.

Scheduled work:

- `clearstep-booking-maintenance`: every minute
- `clearstep-analytics-rollup-retention`: daily; raw 90 days, aggregates 24 months
- `clearstep-runtime-security-retention`: hourly abuse-key/lease/payload cleanup
- `clearstep-automation-worker`: installed separately after Vault secrets exist

## Analytics privacy

The public endpoint accepts explicit event and per-event property allowlists. `checkout_started` and all financial/enrollment/refund events are server-owned. Browser paths/referrers are reduced to safe pathnames; arbitrary properties, transaction identifiers, and sensitive token fields are rejected. An HMAC derived from a short time bucket and request address exists only in `private.analytics_rate_limits`; neither it, a raw IP, nor a user agent enters an event or aggregate. The browser’s only analytics identifier is an optional random session UUID.

## Verification

Repository checks:

```text
npm run lint
npx tsc --noEmit --incremental false
node --test supabase/tests/static-contract.test.mjs
npm test
```

The remote migration history, RLS-enabled table inventory, safe empty anonymous catalog, PGMQ queue, private Meet storage, owner bootstrap, and all twelve active function deployments were verified after deployment. Supabase advisors reported only intentional private-table/no-client-policy and role-scoped security-definer notices plus expected unused-index notices on the fresh database. A disposable test database and Stripe/Workspace test credentials must still prove final-seat competition, cutoff/quote/offer expiry, duplicate/out-of-order and post-start payments, refunds and attendee removal, PGMQ retries, uncertain Gmail delivery, Meet polling, cross-role RLS behavior, rate limits, retention, and health alerts before public sales.
