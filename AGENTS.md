# Clearstep contributor and coding-agent rules

Follow these rules for every change in this repository.

## Work safely and evidence-first

- Inspect the relevant implementation, tests, and documentation before changing behavior. Use `rg` for repository searches.
- Keep a change on a dedicated `codex/` branch unless the task owner directs otherwise. Preserve unrelated work in a dirty tree.
- Never expose, log, commit, paste into an issue, or place in a `NEXT_PUBLIC_` variable a service-role key, provider secret, token, rate-limit salt, or customer data.
- Treat Supabase RLS, Edge Function authorization, and provider-webhook verification as security boundaries. GitHub Pages and client checks are not authorization controls.
- Treat public company contact and complaints wording as static, customer-visible copy—not browser release configuration. When a customer-facing policy or document version changes, verify the deployed checkout Function records the matching version; do not assume Pages deployment proves that parity.
- Keep browser analytics disabled until the current explicit consent is present. Do not add account IDs, page/referrer URLs, tokens, or customer data to analytics events.
- Keep the analytics event schema itself minimal: no account, path, referrer, device, campaign-medium/name, or arbitrary-property columns. Use a direct first-party course ID rather than JSON metadata when a course view needs attribution.
- Do not edit, rename, reorder, delete, or squash historical migrations. Make a new migration for a database change.

## Change and verify

- Add or update focused tests for changed behavior. At minimum run the relevant subset; for meaningful frontend changes also run:

  ```text
  npm run lint
  npm run typecheck
  npm test
  npm run test:a11y
  ```

- For Supabase migration, RLS, checkout, consent, or authorization changes, run `npm run test:db` when Docker is available. Static tests do not prove a remote database, payment provider, or OAuth flow. State that distinction in the handoff and run or plan an integration test where it matters.
- Review the final diff for accidental files, documentation drift, inaccessible interaction changes, secrets, and regressions before handoff.

## Documentation and governance

- Update `README.md` when architecture, setup, configuration boundaries, release process, or verification changes.
- Update `supabase/README.md` when migrations, functions, secrets, runtime boundaries, or deployment steps change.
- Add a dated entry to `changelog.md` for user- or operator-visible fixes and improvements.
- Keep `docs/compliance-accessibility.md` aligned with material data-flow, customer-policy, or accessibility-process changes. It is a release checklist, not a legal certification.
- Keep public company contact and complaints information factual and in one static source of truth. Do not put it in browser environment variables or treat a static build as a complete release check.
- When customer-facing policy text changes, update the matching server-authoritative document version and verify the customer page, checkout acknowledgement, and deployed Function together.
- Keep customer-rights and cancellation requests as human-reviewed intake unless a separately approved process changes that boundary.
- Do not claim a provider configuration, deployment, legal review, accessibility conformance, test, or security outcome unless it was actually verified.

## Audits and GitHub tickets

- During a requested audit, inventory code, configuration, tests, and docs; distinguish confirmed findings from hypotheses.
- Create a GitHub issue only for a confirmed bug, security defect, or clearly scoped maintenance task. Include affected paths or symbols, impact, reproduction or evidence, and a verification condition. Do not include secrets or personal data.
- When a fix is made, comment on the linked issue with the implementation summary, tests actually run, and remaining limitations. Do not close a ticket without evidence that its acceptance condition is met.

## Scope

- Keep public copy factual, accessible, and consistent with the source of truth. Escalate a material legal, tax, licensing, privacy, or business-policy decision instead of silently inventing it.
- Prefer small, reviewable changes. Do not refactor unrelated code merely because it is nearby.
