# Clearstep Supabase backend

This directory contains the database history, RLS policies, security-definer RPCs, Edge Functions, provider integrations, queue operations, and backend contract tests for Clearstep AI. It is the source-controlled implementation; it is not proof that a particular remote project is configured or safe to launch.

## Boundaries

The `public` schema exposes the published catalogue and intentionally limited customer data through RLS and explicit RPC grants. The `private` schema holds operational records such as checkout holds, payments, staff/invitations, provider state, automation jobs, analytics, abuse controls, and audit history. Privileged Edge Function calls use service-only RPCs; the browser must never receive a service-role credential.

Roles are enforced server-side:

- `owner` — all operations, team/role management, and integrations
- `admin` — catalogue, sessions, bookings, waitlists, private requests/quotes, and analytics
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

Before a remote change, verify the linked project and its migration history. Use a non-production project for destructive reset or seed experiments. A source file alone does not establish that a remote migration was applied.

## Edge Functions

JWT verification modes are declared in `config.toml`; function-level authorization remains mandatory even when JWT verification is disabled for a signed webhook or OAuth callback.

| Function | Caller/control | Responsibility |
| --- | --- | --- |
| `create-checkout` | authenticated user | Creates an atomic hold and Stripe Checkout for public, waitlist, or private-quote purchases |
| `stripe-webhook` | verified Stripe signature | Applies idempotent payment/refund lifecycle events and records processing failures |
| `join-waitlist` | authenticated user | Adds an eligible customer to the FIFO waitlist |
| `private-workshop-request` | public validation | Validates a request and queues follow-up work |
| `admin-catalog` | authenticated, action-level role checks | Staff catalogue, booking, quote, analytics, queue, and health operations |
| `staff-invite` | owner | Creates a single-use staff invitation |
| `staff-invite-accept` | invited authenticated email | Consumes a valid invitation |
| `google-oauth-start` | owner | Starts signed Workspace OAuth with PKCE |
| `google-oauth-callback` | signed callback state | Validates the callback and stores tokens in Vault |
| `automation-worker` | worker secret | Processes Gmail and Calendar jobs from PGMQ |
| `analytics-ingest` | explicit consent + public validation + private rate limit | Accepts allowlisted, consent-bound browser events |
| `auth-send-email-hook` | Standard Webhooks signature | Sends branded Supabase Auth mail |
| `customer-requests` | authenticated customer | Records and lists customer data-rights and booking-change requests for human review |

## Local configuration

Copy `supabase/.env.example` to a local, ignored environment file only when you need to exercise Edge Functions locally. Its values are deliberately non-production placeholders. Configure the local Supabase CLI separately; `config.toml` uses local URLs and callback settings.

Production values are managed in the intended Supabase project. Never commit, print, or add to a GitHub Pages environment:

| Secret/configuration | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL`, `ADMIN_NOTIFICATION_EMAIL` | Same-origin links and operational notifications |
| `RATE_LIMIT_HASH_SALT` | Private abuse-throttle derivation |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_AUTOMATIC_TAX_ENABLED` | Stripe Checkout and webhook controls |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_WORKSPACE_EMAIL`, `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_CALENDAR_ID` | Dedicated Workspace OAuth, Gmail, and Calendar integration |
| `SEND_EMAIL_HOOK_SECRET` | Standard Webhooks verification for the Auth email hook |

The Edge runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Treat all provider secrets, the service-role key, and the rate-limit salt as secrets. The browser uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the root project configuration.

## Analytics boundary

Browser analytics is optional and begins only after explicit consent to the current policy version. The consented event table has only an opaque consent ID, random per-tab identifier, allowlisted event name, optional first-party course ID, constrained campaign source, and timestamps—never an account ID, route, referrer, device field, campaign medium/name, or arbitrary JSON property. Withdrawing consent stops browser collection immediately and deletes raw events linked to that consent identifier. Raw consented events are retained for at most 30 days; daily browser aggregates are retained for up to 12 months only when they contain at least 20 distinct consent identifiers. Operational reporting is derived from authoritative booking, payment, waitlist, request, and automation records instead of browser analytics events.

## Legal acceptance, customer rights, and retention

The checkout Edge Function requires an explicit acknowledgement and records the server-authoritative Terms and Cancellation document versions for the checkout attempt. Public company contact and complaints wording is static page content, not Edge Function configuration. When customer-facing policy text or a document version changes, update the matching version in `shared/legal-documents.ts` and deploy the frontend and Edge Function together. The Pages workflow does not itself deploy or attest the production Edge Function bundle, so the release owner must record that parity separately until the release-integrity gate is automated. An acknowledgement record shows which version a customer accepted; it does not evaluate the policy itself.

`customer-requests` is an authenticated intake and status endpoint, not an automated access export, erasure, cancellation, or refund decision. It verifies that a cancellation request belongs to the caller’s enrollment and writes an audit trail. Owners may review all customer-rights requests; administrators are limited to cancellation requests. Staff must use the documented operating process and applicable requirements before resolving a request.

`private.retention_registry` intentionally contains unresolved categories. It is an auditable reminder that a retention decision is unresolved, not an automatic deletion schedule. Do not use it to delete records until the owner has recorded an applicable category-specific period and operating process.

## Safe deployment sequence

1. Confirm the target project reference, environment, and change window.
2. Review the migration diff and role/RLS impact; use an isolated database for reset or migration experiments.
3. Apply pending migrations only after backup/rollback and owner approval are in place.
4. Deploy the matching Edge Functions and verify their `config.toml` JWT modes.
5. Set or rotate runtime secrets through Supabase secret management, not source control or frontend configuration.
6. Exercise anonymous, customer, analyst, admin, and owner boundaries; test checkout/webhook/provider paths with test credentials.
7. Verify the rendered public company contact, complaints, and policy pages alongside the matching document versions and checkout acknowledgement path.
8. Record the deployment, verification evidence, known limitations, and any follow-up ticket.

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

`npm run test:db` requires Docker and applies migrations to a disposable local Supabase stack before running pgTAP. These checks do not replace end-to-end tests against Stripe and Google test credentials. See the root [release gate](../README.md#release-gate) and [compliance/accessibility guide](../docs/compliance-accessibility.md) before public launch.
