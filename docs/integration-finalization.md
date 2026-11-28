# D'Helenas: Final Integration Preparation

Baseline desta rodada: `codex/production-hardening`, HEAD `e20a16f1318ff30e842c26b9ffada44997945f08`.
This sprint prepares code and operator gates. It does not activate production integrations, authorize a real OAuth account, send email, buy a label, create an order/payment, refund, change credentials, change main, merge PR #3 or turn maintenance off.

## Melhor Envio

| Environment | Credentials | Callback | Encrypted token store |
|---|---|---|---|
| Sandbox | Existing `MELHOR_ENVIO_CLIENT_ID`, `MELHOR_ENVIO_CLIENT_SECRET`, `MELHOR_ENVIO_REDIRECT_URI`; optional `MELHOR_ENVIO_SANDBOX_*` equivalents | `https://api.dhelenas.com/api/integrations/melhor-envio/oauth/callback` | `melhor_envio_sandbox_oauth` (preserved) |
| Production | `MELHOR_ENVIO_PRODUCTION_CLIENT_ID`, `MELHOR_ENVIO_PRODUCTION_CLIENT_SECRET`, `MELHOR_ENVIO_PRODUCTION_REDIRECT_URI`, production technical User-Agent | `https://api.dhelenas.com/api/integrations/melhor-envio/oauth/production/callback` | `melhor_envio_production_oauth` |

- Authorize entry points are the respective callback base plus `/authorize` instead of `/callback`. They require verified admin Bearer authentication. The admin integrations page presents each environment separately, with an explicit confirmation before leaving for the official OAuth host; missing configuration disables authorization.
- OAuth state is random, hashed at rest, short-lived and single-use. Production and Sandbox state/code namespaces are distinct. New states also bind client ID and the exact redirect URI. Existing legacy Sandbox states remain compatible.
- Access/refresh tokens are AES-256-GCM encrypted using the existing `INTEGRATION_ENCRYPTION_KEY`. Do not rotate that key or delete the Sandbox row for cutover.
- Refresh locks only the selected environment's row. An invalid OAuth row never falls back to a fixed token. Production cannot borrow legacy Sandbox application credentials or tokens.
- Fixed-token fallback, when used, requires an explicit matching `MELHOR_ENVIO_TOKEN_MODE`; tokens stay server-side. An existing Sandbox row no longer shadows the independent production namespace.
- Minimal scopes for the implemented lifecycle: `shipping-calculate cart-write shipping-checkout shipping-generate shipping-print shipping-tracking users-read`. No wildcard scopes.
- API requests use the environment returned with the selected token, avoiding endpoint/token drift during an awaited operation. Provider calls have bounded timeouts.
- Production requires a configured technical User-Agent, using `MELHOR_ENVIO_PRODUCTION_USER_AGENT` or an operator-approved `MELHOR_ENVIO_USER_AGENT`; it does not invent a production contact from the legacy Sandbox fallback.
- `MELHOR_ENVIO_MODE` remains the effective runtime selector. Completing OAuth does not change this variable. The admin shipping page now displays the backend's active environment rather than an ineffective mode dropdown.
- Generic integration CRUD cannot expose, overwrite or toggle either OAuth namespace. Readiness returns flags, not tokens.

External gates: production application/account, exact registered callback, credentials, technical contact, encrypted authorization, carrier/service permissions, sender approval and a separately authorized quote. A label purchase is never inferred from configuration or quote authorization. Confirm handling of historical TEST/Sandbox orders before any production shipping operation.

Sources: [authentication](https://docs.melhorenvio.com.br/docs/autenticacao), [environment separation and refresh FAQ](https://docs.melhorenvio.com.br/reference/faq), [official authentication SDK](https://github.com/melhorenvio/auth-sdk-php).

## Client Fields and Public Consumers

No real client value was invented or saved by this sprint. Admin input examples are not configured business data.

| Required client data | Admin field / setting | Public consumer |
|---|---|---|
| Legal name | General / `general.company_name` | Footer legal identity, only with a non-placeholder CNPJ |
| Trading name | General / `general.trade_name` | Footer |
| CNPJ | General / `general.cnpj` | Footer; numeric and alphanumeric formats supported, without claiming registry verification |
| Customer service email | General / `general.email` | Contact; optional Reply-To fallback when valid |
| Telephone | General / `general.phone` | Contact, validated telephone link |
| WhatsApp | General / `general.whatsapp`; compatible `social.whatsapp` fallback | Contact, Footer, maintenance page; no all-zero fallback |
| Public boutique address | General / `general.public_address` | Contact; never derived from the private shipping origin |
| Business hours | General / `general.business_hours` | Contact |
| Public pickup location, instructions and time | Shipping / `shipping.pickup_address`, `pickup_instructions`, `pickup_time`, `pickup_name` | Checkout when pickup is selected |
| Instagram profile | Social / `social.instagram` | Contact, Footer, Home and maintenance page; validated Instagram URL/handle |
| Email sender name/address | Emails / `emails.sender_name`, `sender_email` | Backend email envelope; private setting |
| Reply-To mailbox | Emails / `emails.reply_to` | Resend `replyTo`; private setting |
| Approved privacy, returns, terms and shipping policies | Policies / `policies.privacy_policy`, `return_policy`, `terms_of_use`, `shipping_policy` | Policy pages; delivery/returns sections of Product Detail |
| Private shipping origin | Address / `address.cep`, `street`, `number`, `complement`, `district`, `city`, `state` | Backend quote and label eligibility only |
| Private Melhor Envio sender | Sender / `shipping_sender.name`, `document`, `email`, `phone`, `state_register` | Backend label eligibility only |
| Explicitly authorized external CTA/tracking destinations | General / `general.external_link_origins` | Public safe link component and CMS API validation |

The public API now applies a key-and-field allowlist itself, including when legacy private records have been misclassified `is_public=true`. Private origin, sender, email configuration and arbitrary nested fields never become public merely because a client asks for settings. Admins retain their authorized private editing view.

Removed public fallbacks: fictitious company/CNPJ, all-zero WhatsApp, guessed email/address/hours/Instagram profiles, unapproved fixed returns promises and hardcoded garment measurements. Missing policies and measurements use neutral states; missing channels do not render a misleading link. Existing database records, products, stock and order history were not rewritten.

Approve real garment size guides and verify the client CNPJ with the appropriate registry before go-live. If the sender uses an alphanumeric CNPJ, verify Melhor Envio's current document contract before any label operation; no label was purchased to infer support.

## Transactional Email

- `RESEND_API_KEY` remains backend-only. No key was configured or replaced.
- Sender resolution uses private admin email settings, with an existing explicit `EMAIL_FROM` fallback. There is no invented noreply address.
- A sender is eligible only if its exact address is in `EMAIL_ALLOWED_SENDERS` or the explicitly configured `EMAIL_FROM`. This application allowlist is not proof of Resend domain verification.
- Reply-To resolves from `emails.reply_to`, then explicit `EMAIL_REPLY_TO`, then valid `general.email`. Invalid or absent sender/Reply-To fails safely before delivery.
- Validation rejects malformed email addresses and header injection. HTML escapes all dynamic order/customer/item/address fields. Subject lines reject newline injection. Templates cover the existing supported notification events.
- The existing private `notifications.recipients` dispatch remains in place. This sprint does not add recipients, activate customer campaigns, introduce new financial event triggers or resend historical notifications. Per-event email toggles apply to this dispatcher.
- Provider error payloads are not propagated or logged. Failed notification records store a bounded channel error category rather than a raw `err.message`.
- Readiness reports only API-key/sender-and-Reply-To flags, with domain verification explicitly an external gate.
- All email delivery tests use mocks. Live baseline had no Resend key and zero notification records. No real email was sent.

External gates: approved sender/reply mailbox, exact allowed sender addresses, Resend account/domain status `verified`, provider DNS records, mailbox delivery and a separately authorized nonfinancial delivery test.

Sources: [Resend email envelope](https://resend.com/docs/api-reference/emails/send-email), [verified domains](https://resend.com/docs/dashboard/domains/introduction).

## Navigation Security and API Routing

- `safeNavigation` is shared by browser and backend without importing server credentials into the browser bundle.
- Reject unsafe schemes, protocol-relative destinations, credentials in URLs, backslashes, control/bidi characters, malformed percent encoding, encoded variants and dot-segment normalization that could change origin or produce `//`.
- Preserve valid root-relative paths, fragments and same-origin HTTPS links. External HTTPS links require exact origin authorization, never hostname suffix matching. The API rejects unsafe primary, secondary and legacy CTA fields before persistence; public consumers also filter old stored values without rewriting history.
- Instagram/WhatsApp have platform-specific validation. Editable tracking destinations use the same protected link component. OAuth navigation accepts only the selected environment's official authorization host/path.
- Banner edits take precedence over legacy CTA aliases. Clearing the new CTA does not resurrect an obsolete legacy destination.
- Contact, promotions and size guides now use the existing API client and required production API URL, instead of requesting JSON from the SPA host. Error responses are handled by that client rather than treated as successful saves.
- Optional analytics routing is corrected but disabled by default. No new collection is enabled by publishing. An explicit privacy-reviewed `VITE_ANALYTICS_ENABLED=true` build is a separate decision; query strings and full referrers are not included in page context. This is not a certification of LGPD compliance or a replacement for an approved consent/legal-basis workflow.
- React Router was not upgraded major. Its advisory remains in `npm audit`; this application mitigation must not be described as a dependency-level fix.

## Infrastructure: Implemented vs External

Observed by read-only checks:

- `https://dhelenas.com/` and `https://api.dhelenas.com/health` respond over validated HTTPS through Cloudflare. `/health` reports `ok` / `connected`.
- Both known hostnames resolve to Cloudflare addresses. No DNS, certificate, WAF, secret or mode was changed.
- HTML/API responses were `CF-Cache-Status: DYNAMIC`; a fingerprinted JS asset had `max-age=14400`. This observation does not certify every conditional cache rule.
- The backend now emits `Cache-Control: no-store` on API and health, including errors/webhook rejection responses. Production still needs an explicit edge API bypass and a suitable HTML/hashed-assets policy.
- API HSTS is present; frontend HSTS was not observed. Review edge settings only after domains are approved; do not turn on preload by assumption.
- CORS permits the configured frontend, not an untrusted origin. CORS is not server authentication or proof that the origin cannot be accessed directly.
- Backend rate limiting and `trust proxy=1` remain. Edge rules, distributed enforcement and direct Railway origin restriction require authenticated infrastructure evidence, not a header alone.
- Webhook HMAC and financial processing code were not changed. Do not challenge valid webhook delivery with an interactive CAPTCHA or alter signed headers/query at the edge.
- No sender domain is configured/verified by this sprint. SPF/DKIM/DMARC must be checked for the actual approved From/Return-Path and provider-issued selector. Missing apex TXT is not proof about a subdomain; do not invent DKIM records.

Remaining external checks: Cloudflare Full (strict), origin certificate/renewal, domain ownership/targets, direct-origin restriction, WAF/bot/rate/cache rules, signed-component preservation, sensitive-log retention, canonical/www decision, approved email domain, SPF/DKIM/DMARC alignment, MX/reply mailbox and Resend verification.

Sources: [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [cache rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/), [transform rules](https://developers.cloudflare.com/rules/transform/).

## Regression and Release Gates

- Run lint, typecheck, production build with `VITE_API_URL=https://api.dhelenas.com`, all backend tests, production audits in root/backend and `git diff --check` after final changes.
- Baseline tests: 140. Added tests cover environment/token/refresh isolation, OAuth role/state/client/redirect protection, safe email envelopes/failures, public settings privacy, adversarial links, no-store headers, API consumers and neutral public content.
- Repeatable local UI fixture: `node backend/integration/cutover-fixture.mjs --local-fixture`. It starts only loopback mock API/Vite, refuses production mode, never connects a database/provider and blocks financial writes. Its synthetic existing order, contacts and pickup data are not client data.
- Desktop/mobile regression covers catalog, variants, disabled out-of-stock options, cart/coupon, free freight, quote selection, pickup, payment selection only, customer/admin order views, history, inventory, banners, settings, policies and integration readiness. Do not click Confirm Order, payment creation, refund, shipping purchase, credential save or real OAuth confirmation during this sprint.
- Frontend runtime audit after removing three unused direct packages and classifying `tailwindcss-animate` as build-only: `0 critical / 0 high / 2 moderate / 0 low`. Both remaining records are React Router/React Router DOM; the full development graph still reports tooling advisories. React Router remains emitted and its advisory needs continued tracking. Backend runtime audit currently reports zero. See the newer launch matrix in `production-cutover-checklist.md`.
- Before push review the full diff and ensure no real keys/client data, financial/HMAC changes, destructive migrations or unrelated work are staged. The additive migration 014 is staged as code only and requires a separately approved database application. Publish only the authorized branch, then verify CI, both Railway deployment SHAs, health and maintenance.
- Compare pre/post read-only order and stock digests plus counts of orders, movements, restorations, refunds, coupon usages and notifications. Confirm preserved Sandbox metadata and unchanged runtime modes. Do not use a secret fingerprint as evidence.

## Exact Next External Actions

1. Collect and approve the client fields in the table, policies, sender details, destination origins and garment guides. Enter values only through a separately authorized configuration round.
2. Prepare Melhor Envio production application credentials, exact callback and real technical contact; only then explicitly authorize OAuth in the admin. Keep the active Sandbox mode until production activation is separately authorized.
3. Configure Resend/domain/DNS/allowed sender/Reply-To through the authorized operator, verify domain/mailbox status and request a separate delivery-test authorization. Do not send email as an implicit deployment check.
4. Obtain nonsecret Mercado Pago TEST application/notification metadata for the existing DH-2026-000010 delivery. The owner confirmed the secret; the historical mismatch cause remains inconclusive. Do not change HMAC or rotate the confirmed key by hypothesis. Only existing retries may be used for further real observation.
5. Production Mercado Pago has separate gates: production application/token/public key, `MERCADO_PAGO_MODE=production`, production webhook secret/URL, Pix availability and connection checks. No live financial smoke test is authorized by this checklist.
6. Verify external infrastructure gates with authenticated access. Only after all cutover gates pass obtain explicit authorization for any financial test, label purchase or maintenance removal. Main and PR #3 remain unchanged/unmerged.
