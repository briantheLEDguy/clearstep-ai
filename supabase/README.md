# BNC Consulting Supabase backend

This directory contains the shared database history, RLS policies, security-definer RPCs, Edge Functions, provider integrations, queue operations, and backend contract tests for Clearstep AI and Plate & Post. It is the source-controlled implementation; it is not proof that a particular remote project is configured or safe to launch.

## Boundaries

The `public` schema exposes the published catalogue and intentionally limited customer data through RLS and explicit RPC grants. The `private` schema holds operational records such as checkout holds, payments, staff/invitations, provider state, automation jobs, analytics, abuse controls, and audit history. Privileged Edge Function calls use service-only RPCs; the browser must never receive a service-role credential.

Roles are enforced server-side:

- `owner` — all operations, team/role management, and integrations
- `admin` — workshop and service catalogues, sessions, bookings/service orders, waitlists, private requests/quotes, and analytics
- `analyst` — own staff context and analytics summary only

## Migrations

Migration history is append-only. Never edit, rename, delete, reorder, or squash a migration after it may have been applied to a shared environment. Add a new timestamped migration and test the upgrade path instead.

Apply these files in lexical order:

1. `20260818130000_clearstep_core.sql` — core records, constraints, RLS, grants, and owner bootstrap
2. `20260818130050_operations_schema.sql` — operational records, catalogue/account RPCs, analytics rollup and retention
3. `20260818130100_booking_workflows.sql` — checkout holds, waitlists, private requests/quotes, Stripe and refund workflows
4. `20260818130200_admin_analytics_automation.sql` — staff, Google state, administration, analytics, and PGMQ worker RPCs
5. `20260818130300_booking_maintenance_cron.sql` — booking-maintenance scheduling
6. `20260818130400_seed_clearstep_catalog.sql` — draft seed catalogue and fixed session references
7. `20260818130500_runtime_security_hardening.sql` — Vault-backed tokens, analytics throttling, durable delivery controls, queue safety, and sensitive-payload cleanup
8. `20260818200414_admin_controls.sql` — audited price replacement and owner-only automation controls
9. `20260819114628_consent_gated_analytics.sql` — explicit opt-in records, consent-bound browser analytics, withdrawal, and raw-event deletion
10. `20260819115439_customer_rights_legal_acceptance.sql` — versioned checkout acknowledgement, authenticated customer-rights/cancellation intake, and an auditable retention-review registry
11. `20260819122143_dashboard_overview_action.sql` — role-checked aggregate-only admin overview action
12. `20260819123000_admin_cursor_pagination.sql` — role-checked, bounded cursor pages for high-volume staff detail views
13. `20260819125320_strict_anonymous_analytics_schema.sql` — removes legacy account/route/referrer/campaign/JSON analytics columns and stores course views through a direct first-party course ID
14. `20260819140629_versioned_checkout_legal_acceptance.sql` — preserves every distinct Terms/Cancellation version acknowledged when an active checkout is retried
15. `20260819161227_bnc_service_commerce.sql` — shared service lines, draft Plate & Post offerings, service checkout/orders, customer ownership, staff fulfilment, aggregate analytics, and webhook-authoritative payment/refund processing

Before a remote change, verify the linked project and its migration history. Use a non-production project for destructive reset or seed experiments. A source file alone does not establish that a remote migration was applied.

## Edge Functions

JWT verification modes are declared in `config.toml`; function-level authorization remains mandatory even when JWT verification is disabled for a signed webhook or OAuth callback.

| Function | Caller/control | Responsibility |
| --- | --- | --- |
| `create-checkout` | authenticated user | Creates a workshop hold or Plate & Post service attempt, verifies the Price, records legal acceptance, creates Stripe Checkout, and atomically attaches the Session/pending service order |
| `stripe-webhook` | verified Stripe signature | Dispatches workshop and service events, then applies idempotent payment/refund lifecycles and records processing failures |
| `join-waitlist` | authenticated user | Adds an eligible customer to the FIFO waitlist |
| `private-workshop-request` | public validation | Validates a request and queues follow-up work |
| `admin-catalog` | authenticated, action-level role checks | Shared workshop/service catalogue, booking/order, fulfilment, quote, analytics, queue, and health operations |
| `staff-invite` | owner | Creates a single-use staff invitation |
| `staff-invite-accept` | invited authenticated email | Consumes a valid invitation |
| `google-oauth-start` | owner | Starts signed Workspace OAuth with PKCE |
| `google-oauth-callback` | signed callback state | Validates the callback and stores tokens in Vault |
| `automation-worker` | worker secret | Processes Gmail and Calendar jobs from PGMQ |
| `analytics-ingest` | explicit consent + public validation + private rate limit | Accepts allowlisted, consent-bound browser events |
| `auth-send-email-hook` | Standard Webhooks signature | Sends branded Supabase Auth mail |
| `customer-requests` | authenticated customer | Records and lists customer data-rights and booking-change requests for human review |

## Plate & Post service commerce

Service packages intentionally do not reuse workshop tables. `service_lines` assigns Clearstep workshops and Plate & Post packages to stable business units; `service_offerings` holds the service catalogue; and `service_orders` holds a customer-owned payment snapshot plus a staff-managed manual-fulfilment state. One shared account can read its workshop enrollments and service orders, while the existing staff workspace manages both. Before redirecting the customer, service checkout transactionally attaches the Stripe Session and creates a `pending` order; only verified Stripe webhooks settle, fail, or refund its payment status. Checkout completion pages remain informational.

Migration 15 seeds three public-but-draft Plate & Post offerings without Stripe identifiers. Drafts do not appear in the anonymous catalogue or sitemap and cannot be checked out:

| Offering | Catalogue amount |
| --- | ---: |
| Basic Product Shoot | €50.00 |
| Video Content | €75.00 |
| Combo Package | €100.00 |

Create the initial test configuration in **test mode of the existing BNC Stripe account**; do not create another Stripe account and do not put provider IDs in a migration:

1. Confirm the deployed `STRIPE_API_KEY` is a test key for the intended existing account. Stripe test and live objects are separate even when they belong to the same account.
2. Create one active Product and one active, one-time EUR Price for each row above. Each Price must use the exact amount and `tax_behavior=inclusive`. The planned configuration keeps `STRIPE_AUTOMATIC_TAX_ENABLED=false`, but those two settings alone do **not** calculate or display VAT on an invoice. Obtain finance/tax approval for any manual inclusive Tax Rate, then verify the Checkout and invoice VAT breakdown before publishing.
3. In the shared staff catalogue, open **Stripe pricing** for each package, enter its test `prod_…` and `price_…` IDs, and choose **Verify and save**. The server rejects an inactive Product/Price, recurring or mismatched Price, wrong currency/amount/Product, or non-inclusive tax behavior.
4. Publish a package only after verification. Exercise authenticated Checkout, signed webhook processing, the customer order view, confirmation/admin email, refund handling, and staff fulfilment transitions in test mode. The staff price editor creates a new immutable inclusive Price for future checkouts; it does not rewrite past orders.

Repeat the provider setup and acceptance evidence with separately created live-mode Products/Prices before live sales. Attaching a test Price never proves live-mode readiness.

`service_analytics_summary(actor, from, to)` exposes only aggregate counts and cent totals for an approved date range. Owner, admin, and analyst roles may request it through the protected staff action; it returns no customer email, order identifier, or other row-level personal data.

## Local configuration

Copy `supabase/.env.example` to a local, ignored environment file only when you need to exercise Edge Functions locally. Its values are deliberately non-production placeholders. Configure the local Supabase CLI separately; `config.toml` uses local URLs and callback settings.

Production values are managed in the intended Supabase project. Never commit, print, or add secret values to the Cloudflare Pages or GitHub Actions frontend environment:

| Secret/configuration | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL`, `ADMIN_NOTIFICATION_EMAIL` | Canonical same-origin links and operational notifications; production `PUBLIC_SITE_URL` becomes `https://www.bncconsulting.nl` at cutover |
| `RATE_LIMIT_HASH_SALT` | Private abuse-throttle derivation |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_AUTOMATIC_TAX_ENABLED` | Stripe Checkout and webhook controls |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_WORKSPACE_EMAIL`, `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_CALENDAR_ID` | Dedicated Workspace OAuth, Gmail, and Calendar integration |
| `SEND_EMAIL_HOOK_SECRET` | Standard Webhooks verification for the Auth email hook |

The Edge runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Treat all provider secrets, the service-role key, and the rate-limit salt as secrets. The browser uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the root project configuration.

## BNC domain cutover

The domain migration is a coordinated runtime change, not a DNS-only operation. Follow the [Cloudflare Pages and DNS runbook](../docs/cloudflare-pages-runbook.md) and record the live settings without exposing their values.

1. Serve the validated application over HTTPS at `https://www.bncconsulting.nl` before changing generated links.
2. Add the exact `https://www.bncconsulting.nl/auth/callback` Redirect URL in Supabase Auth while retaining `https://www.clearstep-ai.nl/auth/callback` for the recorded transition/rollback window. Change the Auth Site URL only after the new callback has passed email and Google sign-in tests.
3. Set the deployed Edge Function `PUBLIC_SITE_URL` to `https://www.bncconsulting.nl` and deploy the matching frontend/Function release. This changes checkout success/cancel URLs, private-quote and staff-invite links, branded Auth mail, automation links, and the admin destination after Workspace OAuth.
4. Keep the Workspace `GOOGLE_OAUTH_REDIRECT_URI` on its Edge Function callback unless that endpoint itself changes. The Stripe webhook also remains on its signed Supabase endpoint.
5. Test a fresh magic link, Google sign-in, staff invitation, private quote, checkout success/cancel path, and signed webhook delivery. Existing browser sessions and PKCE state are origin-scoped, so require a fresh sign-in on the BNC domain rather than attempting to transfer them.
6. Keep every old-domain redirect query-preserving for outstanding customer links. Prefix legacy Clearstep marketing paths with `/clearstep`; retain only the allowlisted shared account, Auth, checkout, staff/admin, sign-in, and legal paths at the BNC root; and send any other old path to `/clearstep/`. Remove the old Supabase Auth callback only after its agreed transition window and evidence review.

## Analytics boundary

Browser analytics is optional and begins only after explicit consent to the current policy version. The consented event table has only an opaque consent ID, random per-tab identifier, allowlisted event name, optional first-party course ID, constrained campaign source, and timestamps—never an account ID, route, referrer, device field, campaign medium/name, or arbitrary JSON property. Withdrawing consent stops browser collection immediately and deletes raw events linked to that consent identifier. Raw consented events are retained for at most 30 days; daily browser aggregates are retained for up to 12 months only when they contain at least 20 distinct consent identifiers. Operational reporting is derived from authoritative booking, payment, waitlist, request, and automation records instead of browser analytics events.

## Legal acceptance, customer rights, and retention

The checkout Edge Function requires an explicit acknowledgement and records the server-authoritative Terms and Cancellation document versions for the checkout attempt. The current shared Terms, Privacy, and Cancellation identifiers are `2026-08-19.2`; never infer a deployed Function's version from that source file alone. Public company contact and complaints wording is static page content, not Edge Function configuration. When customer-facing policy text or a document version changes, update the matching version in `shared/legal-documents.ts` and deploy the frontend and Edge Function together. The Cloudflare Pages workflow does not itself deploy or attest the production Edge Function bundle, so the release owner must record that parity separately until the release-integrity gate is automated. An acknowledgement record shows which version a customer accepted; it does not evaluate the policy itself.

`customer-requests` is an authenticated intake and status endpoint, not an automated access export, erasure, cancellation, or refund decision. It verifies that a cancellation/change request belongs to exactly one caller-owned workshop enrollment or service order and writes an audit trail. Owners may review all customer-rights requests; administrators are limited to cancellation and change requests. Staff must use the documented operating process and applicable requirements before resolving a request.

`private.retention_registry` intentionally contains unresolved categories. It is an auditable reminder that a retention decision is unresolved, not an automatic deletion schedule. Do not use it to delete records until the owner has recorded an applicable category-specific period and operating process.

## Safe deployment sequence

1. Confirm the target project reference, environment, and change window. Compare local and linked history with `npx supabase migration list --linked`; stop if the remote contains an unexpected migration, a local predecessor is missing remotely, or the order diverges. Resolve drift without editing historical files.
2. Review the migration diff and role/RLS impact; use an isolated database for reset or migration experiments.
3. Apply pending migrations only after backup/rollback and owner approval are in place. Confirm migration 15 leaves all three Plate & Post offerings draft with null Stripe IDs.
4. Deploy the matching `admin-catalog`, `create-checkout`, `customer-requests`, `stripe-webhook`, `automation-worker`, and `auth-send-email-hook` bundles, then verify their `config.toml` JWT modes. Shared helper changes are bundled only when an importing Function is deployed.
5. Set or rotate runtime secrets through Supabase secret management, not source control or frontend configuration. Attach and publish test-mode service Products/Prices only through the reviewed staff/provider procedure above.
6. Exercise anonymous, customer, analyst, admin, and owner boundaries; test both checkout kinds, webhook/provider paths, service-order ownership, staff fulfilment transitions, email jobs, refunds, and duplicate/out-of-order events with test credentials.
7. Verify the rendered public company contact, complaints, and policy pages alongside the matching document versions and checkout acknowledgement path.
8. Record the database and Function deployment identifiers, provider mode, verified Product/Price presence (not secret keys), verification evidence, known limitations, and any follow-up ticket.

Do not mark a deployment complete merely because an Edge Function deploys or the static frontend builds. In particular, confirm seat competition, checkout expiry, provider failure/retry behavior, refunds, email uncertainty handling, calendar changes, invite/quote/waitlist authorization, rate limits, retention, and RLS isolation.

## Repository verification

Run the frontend checks from the repository root:

```text
npm run lint
npm run typecheck
node --test supabase/tests/static-contract.test.mjs
npm test
npm run test:a11y
npm run test:db
```

`npm run test:db` requires Docker and applies migrations to a disposable local Supabase stack before running pgTAP. At the 2026-08-19 BNC handoff, the suite contains 109 assertions but was not executed because Docker Desktop is unavailable in the workspace; run it in a Docker-capable environment before applying migration 15. These checks do not replace end-to-end tests against Stripe and Google test credentials. See the root [release gate](../README.md#release-gate) and [compliance/accessibility guide](../docs/compliance-accessibility.md) before public launch.
