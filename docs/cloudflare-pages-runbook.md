# Cloudflare Pages and DNS cutover runbook

Use this runbook to move the BNC Consulting application to Cloudflare Pages and make `https://www.bncconsulting.nl` canonical while keeping routable Clearstep links useful. Repository changes do not prove that any Cloudflare, registrar, Supabase, Stripe, or Google setting is live. Record the operator, time, provider screenshots/exports, and verification results for every production change; never include tokens, one-time customer links, or secret values in that evidence.

Cloudflare references:

- [Direct Upload with continuous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Full DNS zone setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Single Redirects](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/)
- [Pages static headers](https://developers.cloudflare.com/pages/configuration/headers/)

## Target topology

| Host | Target behavior |
| --- | --- |
| `www.bncconsulting.nl` | Canonical Cloudflare Pages custom domain |
| `bncconsulting.nl` | HTTPS redirect to the same path/query on `www.bncconsulting.nl` |
| `clearstep-ai.nl` and `www.clearstep-ai.nl` | Exact root and unknown paths redirect to `/clearstep/`; legacy Clearstep marketing paths gain the `/clearstep` prefix; allowlisted shared customer/utility paths retain their path; every rule preserves the query |
| `<project>.pages.dev` and preview aliases | Not indexable through `public/_headers`; redirect to the canonical host after the custom domain is stable |

The old-domain split is deliberate. A blanket redirect to `/clearstep/` would destroy workshop, account, Auth, checkout, invitation, quote, and policy links. Preserving every path unchanged would also break legacy marketing URLs because those pages now live below `/clearstep/`, and it would send unrelated old paths to BNC-branded 404 pages. DNS records alone cannot perform this HTTP path mapping.

## 1. Preflight and rollback evidence

1. Choose a change window and name one operator and one reviewer.
2. Export or capture the complete current DNS zones for both domains, including `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `CAA`, `SRV`, DNSSEC/DS, and TTL values. Preserve mail and verification records even when they are unrelated to the website.
3. Confirm the registrar still owns and has activated `bncconsulting.nl`. It delegated successfully during the refreshed 2026-08-19 audit; do not assume that snapshot is still current at the change window.
4. Record the last known-good frontend commit, Cloudflare Pages deployment, Supabase Auth Site URL/Redirect URLs, and the presence—not the value—of `PUBLIC_SITE_URL`.
5. Confirm whether the site is accepting real bookings or service orders. Record aggregate counts of Checkout attempts in `creating`, `open`, or `payment_pending`, active workshop holds, and unexpired one-time Auth, invite, quote, or waitlist links—never their tokens or customer details. Define the drain and customer-support window before redirecting the old origin; an HTTP redirect cannot transfer a Supabase session or PKCE verifier to another origin.
6. Reduce web-record TTLs to 300–600 seconds at least one prior TTL window before cutover when the current provider permits it.
7. Keep the existing Clearstep site and redirects recoverable until the BNC host, authentication, and test checkout have passed.

Read-only Windows checks:

```powershell
Resolve-DnsName -Name bncconsulting.nl -Type NS
Resolve-DnsName -Name bncconsulting.nl -Type A
Resolve-DnsName -Name www.bncconsulting.nl -Type A
Resolve-DnsName -Name www.bncconsulting.nl -Type AAAA
Resolve-DnsName -Name clearstep-ai.nl -Type A
Resolve-DnsName -Name www.clearstep-ai.nl -Type CNAME
```

The read-only 2026-08-19 snapshot found:

| Zone | Web and delegation records | Mail/verification observation |
| --- | --- | --- |
| `bncconsulting.nl` | `nsn1.mijndomein.nl` / `nsn2.mijndomein.nl`; apex and `www` A `213.249.67.10`; apex and `www` AAAA `2a01:448:2001::10`; web TTL 600 | SPF TXT present; no MX answer |
| `clearstep-ai.nl` | Same nameservers; apex GitHub Pages A records `185.199.108.153` through `185.199.111.153`; `www` CNAME `briantheledguy.github.io`; web TTL 600 | SPF TXT present; no MX or apex AAAA answer |

Both zones returned a DNSKEY but no parent DS answer in that snapshot. Verify the registrar’s live DNSSEC state rather than inferring it from either record alone. Re-export the zones at cutover; this table is evidence of the audit, not permission to discard records that appeared later.

The observed SPF value on both zones uses `a` and `mx` mechanisms: `v=spf1 a mx include:spf.mijndomeinhosting.nl -all`. Replacing the website A/AAAA records changes what `a` authorizes even if the TXT record itself is copied exactly. Before cutover, ask the actual mail provider whether the `include` is sufficient or whether it requires a provider-approved SPF change; do not improvise or add a second SPF record.

## 2. Provision the Direct Upload project and GitHub environment

1. In the intended Cloudflare account, create a **Pages / Direct Upload** project and set its production branch to `main`. Direct Upload is intentional because GitHub Actions must retain the hourly catalogue rebuild and database verification gate. Cloudflare does not allow a Direct Upload project to be converted to Git integration later; create a replacement project if that strategy changes.
2. Create a least-privilege Cloudflare API token scoped to the intended account with **Account → Cloudflare Pages → Edit**. Do not grant zone or DNS write access to the CI token.
3. In GitHub, create the protected `cloudflare-pages` environment and restrict production deployments to `main`. The workflow intentionally deploys an hourly catalogue refresh, so a required-reviewer rule would queue every scheduled run; rely on protected `main` reviews unless the release owner explicitly accepts that operational tradeoff.
4. Store `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as environment/repository Actions secrets. Store the exact Direct Upload project name as `CLOUDFLARE_PAGES_PROJECT_NAME` in Actions variables.
5. Run the pull-request workflow first. It must complete build, lint, type checks, frontend/static contracts, accessibility checks, and the disposable Supabase integration suite while the deploy job remains skipped.
6. Run a protected `main` or manual-`main` deployment. Confirm Wrangler deployed the downloaded `cloudflare-pages-site` artifact—the same `out/` artifact created by the validated build job.

Do not put the API token, account ID, project ID, DNS credentials, Supabase service-role key, or provider secrets in source files, build variables, artifacts, logs, or tickets.

## 3. Onboard DNS without losing unrelated records

Cloudflare Pages requires the apex domain to be a full Cloudflare zone in the same account as the Pages project. For each domain that will use Cloudflare zone redirects:

1. Add the domain to Cloudflare and review the imported records against the preflight export. Automatic scanning is not authoritative; recreate anything missing before changing nameservers.
2. If DNSSEC is enabled at the registrar, follow Cloudflare’s migration guidance. For the standard full-zone flow, disable the old DS/DNSSEC delegation before replacing nameservers, then re-enable DNSSEC in Cloudflare only after the zone is Active.
3. Replace the registrar nameservers with the two nameservers assigned by Cloudflare. Copy them exactly and wait until the zone status is **Active**.
4. Re-run NS, mail, TXT, and web-record checks through multiple public resolvers. Stop and restore the recorded delegation if mail or another existing service is missing.
5. In the Pages project, add `www.bncconsulting.nl` and `bncconsulting.nl` through **Custom domains**. Do not create a standalone CNAME first; Pages must associate the hostname before serving it. Replace the imported Mijndomein parking A/AAAA records only when Pages prompts for the conflicting web record, then wait for active DNS and certificates on both names.
6. Onboard the old Clearstep zone and associate both old hosts with the Pages project so Cloudflare can proxy them and issue TLS before redirects are enabled. Replace only the recorded GitHub Pages web A/CNAME targets during that association and preserve every non-web record from the old provider.

Do not enable HSTS with `includeSubDomains` until every present and planned subdomain is confirmed HTTPS-capable. Do not add wildcard DNS records.

## 4. Coordinate application and Supabase URLs

1. Confirm the deployed BNC build renders with canonical metadata, sitemap, robots, and Organization/service structured data on `https://www.bncconsulting.nl`.
2. Add `https://www.bncconsulting.nl/auth/callback` to Supabase Auth Redirect URLs before changing the Site URL. Keep the old `https://www.clearstep-ai.nl/auth/callback` only for the recorded drain/rollback window; allowing it does not transfer its origin-scoped PKCE state through a redirect.
3. Test email and Google sign-in on the BNC host, then set the Supabase Auth Site URL to `https://www.bncconsulting.nl`.
4. Set the deployed Edge Function `PUBLIC_SITE_URL` to `https://www.bncconsulting.nl` and deploy the matching Function release. This setting generates checkout return URLs, quotes, invitations, Auth email links, automation links, and the admin destination after Workspace OAuth.
5. Do not change the signed Stripe webhook endpoint or the Workspace `GOOGLE_OAUTH_REDIRECT_URI` unless their Supabase Edge Function endpoints change.
6. Stop issuing new checkouts on the old origin, keep its callback pages reachable during the drain when possible, and wait at least **75 minutes** before enabling redirects. That covers the 60-minute Plate & Post Checkout Session plus the database's 15-minute expiry grace; the shorter Clearstep workshop window fits inside it. At the end of the drain, require no Checkout attempts in `creating` or `open`. Review `payment_pending` separately and let signed, verified webhooks settle those payments rather than force-closing them.
7. Confirm that outstanding old-origin Auth links have reached the recorded handling point. Replace affected one-time links or ask the customer to sign in again; do not attempt cross-origin session transfer. The signed webhook remains authoritative even if an old success page becomes inaccessible, and a checkout-result page must resolve the order through the signed-in owner's data rather than trust `session_id` alone.
8. Expect existing Auth sessions, analytics consent, and PKCE state to remain on the old origin. Ask users and staff to sign in and choose analytics preferences again on BNC.

## 5. Create Cloudflare redirect rules

Single Redirects require proxied Cloudflare DNS. In the Cloudflare dashboard, select the relevant zone, open **Rules → Overview**, and choose **Create rule → Redirect Rule**. Use **Custom filter expression** for the matches below. Create each rule with **Save as Draft**, deploy it as `302` during the smoke window, and promote it to `301` only after all checks pass. Enable **Preserve query string** for every rule.

Create the BNC apex rule in the `bncconsulting.nl` zone. Create the four old-host rules, in the order shown, in the `clearstep-ai.nl` zone; a zone-level rule in BNC cannot intercept requests to the old domain.

### BNC apex to canonical `www`

- Match: `http.host eq "bncconsulting.nl"`
- Dynamic target: `concat("https://www.bncconsulting.nl", http.request.uri.path)`
- Status: `302`, then `301`
- Preserve query string: enabled

### Old Clearstep exact root

Place this above the non-root rule.

- Match: `(http.host in {"clearstep-ai.nl" "www.clearstep-ai.nl"} and http.request.uri.path eq "/")`
- Static target: `https://www.bncconsulting.nl/clearstep/`
- Status: `302`, then `301`
- Preserve query string: enabled

### Old Clearstep marketing paths

Place this above the shared-route and unknown-path rules. It moves the old marketing routes into the new Clearstep route space while retaining workshop detail suffixes.

- Match:

  ```text
  (http.host in {"clearstep-ai.nl" "www.clearstep-ai.nl"} and (http.request.uri.path in {"/about" "/about/" "/faq" "/faq/" "/guides" "/guides/" "/private-workshops" "/private-workshops/" "/workshops" "/workshops/"} or starts_with(http.request.uri.path, "/workshops/")))
  ```

- Dynamic target: `concat("https://www.bncconsulting.nl/clearstep", http.request.uri.path)`
- Status: `302`, then `301`
- Preserve query string: enabled

### Old Clearstep shared paths

This allowlist keeps the shared sign-in, account, Auth, checkout, staff/admin, and legal routes intact, including their nested paths. Place it above the final unknown-path rule.

- Match:

  ```text
  (http.host in {"clearstep-ai.nl" "www.clearstep-ai.nl"} and (http.request.uri.path in {"/account" "/admin" "/auth" "/checkout" "/staff" "/sign-in" "/sign-in/" "/privacy" "/privacy/" "/terms" "/terms/" "/cancellation" "/cancellation/" "/complaints" "/complaints/"} or starts_with(http.request.uri.path, "/account/") or starts_with(http.request.uri.path, "/admin/") or starts_with(http.request.uri.path, "/auth/") or starts_with(http.request.uri.path, "/checkout/") or starts_with(http.request.uri.path, "/staff/")))
  ```

- Dynamic target: `concat("https://www.bncconsulting.nl", http.request.uri.path)`
- Status: `302`, then `301`
- Preserve query string: enabled

### Old Clearstep unknown paths

This must be the final old-host rule. It sends any non-root path not handled by the marketing or shared-route allowlists to the Clearstep service home rather than preserving an obsolete or unrelated path on the BNC host.

- Match: `(http.host in {"clearstep-ai.nl" "www.clearstep-ai.nl"} and http.request.uri.path ne "/")`
- Static target: `https://www.bncconsulting.nl/clearstep/`
- Status: `302`, then `301`
- Preserve query string: enabled

Cloudflare Pages `_redirects` does not support domain-level source matching, so these host-aware rules do not belong in `public/_redirects`. After the canonical custom domain is stable, use an account-level Bulk Redirect for `<project>.pages.dev` with subpath matching, path-suffix preservation, query preservation, and included preview subdomains. The checked-in `_headers` file keeps provider aliases `noindex` until that rule is active.

## 6. Verify before permanent redirects

Use synthetic, non-sensitive query values only:

```powershell
curl.exe --silent --show-error --head https://www.bncconsulting.nl/
curl.exe --silent --show-error --head https://bncconsulting.nl/plate-and-post/?probe=1
curl.exe --silent --show-error --head https://www.clearstep-ai.nl/
curl.exe --silent --show-error --head "https://www.clearstep-ai.nl/workshops/example--session/?probe=1"
curl.exe --silent --show-error --head "https://www.clearstep-ai.nl/checkout/cancel/?probe=1"
curl.exe --silent --show-error --head "https://www.clearstep-ai.nl/obsolete-path/?probe=1"
curl.exe --silent --show-error --head https://www.bncconsulting.nl/robots.txt
curl.exe --silent --show-error --head https://www.bncconsulting.nl/sitemap.xml
```

Record that:

- BNC `www` returns 200 with the reviewed CSP, framing, content-type, referrer, and permissions headers;
- BNC apex redirects once to the same path/query on `www`;
- old exact root and unknown paths redirect to `/clearstep/`; legacy marketing and workshop links gain the `/clearstep` prefix; representative allowlisted account, Auth, checkout, policy, invite, and admin links retain their root path; and all examples retain their query;
- no redirect loops or unexpected multi-hop chains occur and all certificates are valid;
- the Pages provider/preview aliases are `noindex` and then redirect to the canonical host;
- sitemap, robots, canonical tags, Open Graph URLs, and structured data use only the BNC origin;
- fresh magic-link and Google sign-in, staff/admin access, private quote/invite links, test Checkout success/cancel flows for both a Clearstep workshop and a published Plate & Post service, and signed webhook processing pass;
- the scheduled hourly workflow produces and deploys a fresh catalogue artifact.

After the smoke window and log/support review, change only the approved temporary redirects from 302 to 301. Keep the old Clearstep domain registered and redirected indefinitely. After the agreed rollback window, unpublish the old GitHub Pages deployment and remove its custom-domain setting in the repository’s **Settings → Pages** screen so `briantheledguy.github.io/clearstep-ai` cannot remain a stale duplicate. Record that result separately; Cloudflare cannot redirect a `github.io` hostname that BNC does not control.

## 7. Rollback

1. Before promotion to 301, disable the temporary redirect rules if they misroute traffic.
2. Roll Cloudflare Pages back to the recorded last-known-good deployment or redeploy the recorded commit.
3. Restore the prior Supabase Auth Site URL/Redirect URLs and `PUBLIC_SITE_URL` only as one coordinated application rollback; test newly generated links after doing so.
4. Restore the captured DNS records or nameserver delegation only when the problem is at the DNS/zone layer. Nameserver rollback is slow and is not the first response to an application defect.
5. Re-run authentication, checkout return, webhook, mail, and DNS checks. Record the rollback result and leave permanent redirects disabled until the acceptance conditions pass again.

Never roll back database payment/enrollment facts or webhook history as part of a frontend/domain rollback.
