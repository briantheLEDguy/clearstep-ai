# Compliance and accessibility release guide

Use this checklist to produce evidence for a release decision. It supports a review against GDPR principles, applicable consumer/accessibility obligations, and [WCAG 2.2](https://www.w3.org/TR/WCAG22/); it does not certify legal compliance or decide which laws apply. The release owner must obtain qualified legal advice for the business, countries served, and final customer-facing policies.

## Outcome

Before public sales, the release owner can point to a dated record showing who checked the data flow, customer information, accessibility, providers, and unresolved risks—and can explain why the site was or was not approved.

## 1. Confirm the data and legal basis

Record the controller/legal entity, contact details, countries targeted, data-protection contact, and owner for each review. Map each personal-data flow to a purpose, lawful basis, recipients/processors, retention rule, and rights-request path.

Current implementation areas to review include:

| Flow | Typical data | Check before release |
| --- | --- | --- |
| Auth and account | email, identity/provider identifiers | account lifecycle, access/deletion requests, provider terms |
| Booking and support | attendee/contact details, workshop and waitlist status | contract information, retention, staff access, customer communications |
| Payments | Stripe references and payment status, not full card data | payment-provider terms, tax/VAT, refunds, webhook controls |
| Workspace automation | attendee/contact data and calendar/email delivery state | processor role, OAuth scopes, recipient visibility, retention |
| First-party analytics | only after opt-in: allowlisted events, an opaque consent ID, random per-tab ID, optional first-party course ID, and constrained campaign source | purpose, minimisation, withdrawal/raw-event deletion, absence of account/route/referrer/device/arbitrary-property fields, 30-day raw / 12-month k=20 aggregate retention, consent/ePrivacy assessment |
| Customer rights and booking changes | authenticated request, selected booking, limited explanatory text, review/audit status | identity check, manual decision, response process, retention, staff access |

The European Commission’s guidance stresses lawfulness, transparency, purpose limitation, data minimisation, storage limitation, and appropriate safeguards. Confirm the actual processing notices, contracts, transfers, and retention rules against that guidance and the applicable law rather than relying on this document alone. See [the Commission’s business guidance](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations_en) and [its overview of core principles](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en).

Do not ask for dietary, health, disability, or other special-category information unless the responsible owner has defined a necessary purpose, legal condition, access restriction, and deletion/retention rule. Keep that information out of analytics, public tickets, and ordinary logs. Browser analytics must remain off until the visitor explicitly opts in; its withdrawal path must stop collection immediately and delete the related raw analytics events. The current runtime keeps consented browser analytics raw for at most 30 days and keeps only daily aggregates with at least 20 consent IDs for up to 12 months; check the rendered public copy against that behavior before release.

## 2. Verify the customer-facing information

- Check the displayed company contact, complaints procedure, VAT/tax information, prices, cancellation/refund terms, and accessibility contact against the actual operating model.
- Keep `privacy`, `terms`, `cancellation`, and complaints content factual and aligned with the actual customer flow; record the person responsible for the release review.
- Public company contact and complaints information is static page content, not environment-based configuration. A successful static build only confirms that it renders; it does not independently validate the operating policy.
- Confirm the versions in `shared/legal-documents.ts` match the text shown on the policy pages and the versions recorded with checkout acknowledgements. Issue a new version and record the release review whenever customer-facing policy wording changes. Pages publication currently does not attest the deployed checkout Function bundle, so record the matching Function deployment/version as separate evidence before launch.
- Confirm provider agreements, data-processing roles, international-transfer safeguards, and the rights-request process for Supabase, Stripe, GitHub Pages, and Google Workspace where applicable.
- Assess whether the European Accessibility Act or national implementation applies to the offering; do not infer coverage solely from this repository. The [European Commission’s EAA overview](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en) is a starting point, not a scope determination.

The authenticated request centre is an intake and status mechanism, not an automatic access export, erasure, cancellation, or refund. Test its customer-ownership check, duplicate-request handling, staff-role boundary, status history, and manual resolution process. The retention registry contains unresolved categories; it must not be presented as an automatic deletion schedule.

## 3. Test accessibility against WCAG 2.2 AA

Treat WCAG 2.2 AA as the engineering target unless the release owner records another applicable standard. Test a representative desktop and mobile path, including the homepage, catalogue/detail, sign-in, private-workshop request, booking/waitlist/quote, account, admin, and legal pages.

| Check | Evidence to record |
| --- | --- |
| Keyboard | Every interactive control can receive focus, operate without a pointer, has a visible focus indicator, and does not trap focus. |
| Semantics | Headings, landmarks, labels, error/status messages, dialog behaviour, and icon-only controls have meaningful names and roles. |
| Forms | Required fields, validation, error recovery, time limits, and checkout hand-off are understandable without colour or hover alone. |
| Visual | Text and controls meet contrast needs, reflow at 200% zoom and narrow widths, and do not require horizontal scrolling except where unavoidable. |
| Assistive technology | Perform and record an NVDA/Firefox pass and a VoiceOver/Safari pass; verify the announced page title, form labels/errors, live statuses, and modal focus order. |
| Motion and media | Respect reduced-motion preferences where motion is introduced; provide captions/transcripts or an equivalent before publishing recorded media. |
| Content | Dates, prices, cancellation terms, and provider limits are clear; no essential instruction depends only on an image, colour, or gesture. |

Automated checks can find regressions but do not prove accessibility. Record the browser/device, keyboard/screen-reader method, pages tested, defects, owner, and retest result. Do not claim conformance until all applicable success criteria have been assessed.

## 4. Release evidence and incident readiness

Before a release decision, record:

- commit/PR, deployment URL, review date, reviewer, and test commands/results;
- security/RLS/provider test evidence and open risk acceptance;
- accessibility findings and retest status;
- Chromium/Axe result plus manual keyboard, NVDA/Firefox, VoiceOver/Safari, 320px/reflow, dialog, and form-error evidence;
- responsible owner, rendered customer-facing copy, and complaints procedure;
- rendered company contact, complaints, and policy pages; the policy-version/checkout-acknowledgement check; and the customer-rights request review process;
- Stripe and Google test-provider evidence, including checkout/webhook and email/calendar failure paths, where those providers are enabled;
- configuration confirmation that secret values are stored only in their provider and that GitHub Pages receives public build values only.

GitHub Pages cannot supply application-defined response headers, so do not rely on static hosting as the security boundary. Retain RLS, authenticated Edge Function authorization, webhook verification, and provider-side access controls. Route suspected vulnerabilities through [SECURITY.md](../SECURITY.md); do not put confidential evidence in a public issue.

## 5. Revisit this guide

Repeat this review when a new provider, analytics event, data category, payment method, market, public form, accessibility interaction, or legal policy is introduced. Create a scoped ticket for any confirmed gap and link its resolution to the release evidence.
