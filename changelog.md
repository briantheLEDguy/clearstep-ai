# Changelog

## 2026-08-18 — Local workspace portability

### Fixed

- Normalized CRLF line endings in the Supabase static-contract test reader so the full safety suite behaves consistently in Windows and Linux checkouts.

## 2026-08-18 — Domain validation and Stripe sandbox wiring

### Completed

- Confirmed active routing and SSL for `www.clearstep-ai.nl` while preserving owner-only site access.
- Rotated and deployed the Stripe sandbox server key without storing it in the repository.
- Created three active, VAT-inclusive, one-time EUR sandbox Prices and linked them to the matching draft courses without publishing sales.
- Added the signed Supabase webhook endpoint for the five required Checkout/refund events and stored its signing secret in Supabase.
- Sent a synthetic signed, non-payment delivery probe; Supabase verified the signature, processed the event safely, and reported healthy webhook integration status.
- Stored the exact secondary `Clearstep Workshops` calendar ID, Workspace identity/domain, OAuth callback, owner notification address, analytics abuse salt, and disabled automatic-tax flag in Supabase.

### Still gated

- Stripe reports payments disabled until the sandbox business profile requirements and terms are completed.
- Real card/iDEAL checkout, invoice, asynchronous-payment, refund, and duplicate/out-of-order webhook acceptance remain outstanding.
- The Google Workspace OAuth client credentials, owner consent, token storage, Calendar/Gmail provider tests, and worker cron remain outstanding.
- The Sites deployment remains owner-only pending the other provider, legal, tax, asset, and acceptance gates.

## 2026-08-18 — Custom-domain preparation

### Changed

- Switched canonical metadata, sitemap, robots, checkout return URLs, invitations, quotes, and other server-generated links to `https://www.clearstep-ai.nl`.
- Updated the Sites production environment and Supabase production Site URL for the attached `www.clearstep-ai.nl` hostname while preserving owner-only access.
- Added the matching `PUBLIC_SITE_URL` Edge Function secret without exposing provider credentials.
- Tightened rendered-page and search-discovery tests to require the custom-domain origin.

### Follow-up

- Sites DNS and SSL validation subsequently became active.
- The Supabase dashboard initially returned a server error while saving the redirect allowlist, but a fresh read confirmed that the exact `https://www.clearstep-ai.nl/auth/callback` entry persisted successfully.

## 2026-08-18 — Acceptance implementation

### Added

- Built the “Fresh Confidence” Clearstep AI site with Manrope headings, Source Sans 3 body copy, approved palette, Canva-derived local brand assets, and the message “Make AI useful. Keep it simple.”
- Added the public homepage, workshop catalogue/details, private workshop request, about, FAQ, privacy, terms, and cancellation routes.
- Added Supabase magic-link and Google sign-in, Auth callback handling, student account/bookings/waitlist views, checkout result pages, and staff invitation acceptance.
- Added an access-gated, Supabase-backed staff workspace covering courses, sessions, bookings, waitlists, private requests/quotes, analytics, team, audit history, automation, and integration health.
- Added SEO metadata, canonical URLs, sitemap/robots, a generated social card, and Organization, Course, Event, and breadcrumb structured data.
- Added Supabase migrations for RLS-protected public records and private booking, payment, staff, Google, automation, analytics, audit, and integration records.
- Added Edge Functions for checkout, signed Stripe webhooks, waitlists, private requests, staff invitations, administration, Google OAuth, Gmail/Calendar automation, first-party analytics, and branded Auth email delivery.
- Added PGMQ-backed transactional automation with logical deduplication, retry/backoff, delivery records, integration health, booking maintenance, and analytics retention.
- Seeded three 2026 workshops with fixed session references while leaving Stripe Product/Price IDs unset.

### Security and reliability

- Kept privileged writes behind role-checked Edge Functions and service-only RPCs.
- Enabled RLS and explicit grants on every exposed table; isolated private records from the Data API.
- Added atomic seat holds, one active checkout per user/session, idempotent Stripe event processing, FIFO waitlist offers, and refund tracking.
- Restricted staff activation to the verified bootstrap owner or valid single-use, seven-day invitations for the invited verified email.
- Stored invitation/offer token hashes in their authoritative records, moved Google OAuth credentials to Supabase Vault, and removed delivered raw action links immediately with expiry-based/31-day fallback cleanup for failed recovery.
- Added explicit analytics event/property allowlists and an isolated short-lived database rate limit; arbitrary transaction identifiers, raw IP, user agent, and abuse keys do not enter analytics. Raw events retain for 90 days and aggregates for 24 months.
- Added a conservative Gmail send-intent protocol with deterministic RFC Message-IDs, safe backoff for explicit HTTP rejections, and owner-only reconciliation for ambiguous delivery.
- Serialized Calendar work per session, resolved queued work from current session state, explicitly cleared Meet data for in-person changes, retried pending or provider-failed Meet creation with transition-specific request IDs, and added idempotent attendee removal for full refunds while preserving other attendees.
- Capped private-quote and workshop checkout windows at the earliest authoritative deadline and rejected sessions that cannot fit Stripe’s minimum window.
- Prevented identity, capacity, and status changes on sessions with occupied or paid booking history.
- Persisted verified Stripe processing failures separately without consuming the event ID needed for retry, and degraded webhook health for refund-remediation payments.
- Added durable customer and owner alerts for late payments that cannot be allocated without overselling.
- Added deterministic cleanup and alerts for asynchronous payments that remain unsettled past the seat-grace deadline, while keeping later paid webhooks on the remediation path.
- Aligned catalogue content bounds across the staff form, Edge validation, and database constraints; malformed legacy rows are quarantined instead of taking down the entire public catalogue.
- Added response security headers, safe JSON-LD serialization for staff-editable content, session-specific workshop links, owner-only operational controls, and duplicate-resistant browser analytics.

### Documentation

- Replaced starter documentation with Clearstep architecture, setup, operations, verification, production Auth configuration, and launch-gate guidance.

### Acceptance infrastructure

- Applied all seven reviewed migrations to Supabase project `besjkfgfhraibrlaiejk` and deployed all twelve Edge Functions with their reviewed JWT modes.
- Verified the draft seed, PGMQ queue, RLS-enabled table inventory, private Calendar/Meet boundary, bootstrap owner, empty safe anonymous catalogue, and Supabase security/performance advisors.
- Kept Stripe, Google OAuth/Gmail automation, Auth email delivery, worker invocation, and public sales gated until credentials and provider integration tests are complete.

### Still gated before public launch

- Live Stripe credentials, Prices, tax/VAT setup, webhook configuration, and test-mode acceptance
- Separate student and Workspace OAuth clients, dedicated Calendar connection, Gmail/Calendar verification, and Auth email hook activation
- Production Supabase Auth URLs/provider settings and remote security/performance review
- Provider-backed acceptance tests for checkout cutoffs, late/refund remediation, Gmail uncertainty, Meet readiness, and Calendar refund removal
- Approved legal/tax content, custom domain, trademark/domain clearance, and full-resolution Canva exports
- Private Sites acceptance deployment followed by explicit public-release approval
