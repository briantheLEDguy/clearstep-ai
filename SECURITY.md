# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to [brian@bncconsulting.co](mailto:brian@bncconsulting.co) with the subject **Clearstep AI security report**. Do not open a public issue for an unpatched vulnerability.

Include the affected URL, component, or commit; clear reproduction steps; the security impact; and any safe proof of concept. Do not send production credentials, payment data, personal data, or destructive payloads. If you need a secure transfer method, ask for one before sharing sensitive evidence.

We will assess reports in good faith. Do not access data that is not yours, disrupt the service, bypass payment, use social engineering, or publicly disclose a suspected issue before Clearstep has had a reasonable opportunity to investigate and coordinate a fix.

## Supported surface

Security fixes are assessed for the current default-branch code and deployed Clearstep application. This includes the Next.js frontend, Supabase RLS/RPC boundaries, Edge Functions, authentication, booking/checkout integration, and provider webhooks.

Third-party services should be reported to their own security teams when the issue is solely in their service. Examples include Supabase, Stripe, GitHub, Google, and npm packages.

## Handling rules

- Never include secrets, bearer tokens, webhook signatures, personal data, or live payment details in a GitHub issue, commit, log, screenshot, or test fixture.
- Rotate an exposed credential through its owning provider and review access logs before considering the incident contained.
- Record confirmed findings in the project’s private incident or issue process with impact, remediation, verification, and any customer/legal notification decision.
