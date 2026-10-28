# Experimental Professional Messaging Engineering Features (2026)

**Status:** Experimental roadmap with an initial implemented slice. The consent ledger, suppression store, audience preflight, and draft persistence are implemented in `src/35-consent-campaign-engine.js` and exposed through authenticated local API routes. The broader provider and reliability features below remain a roadmap unless explicitly marked implemented. CI/device verification is tracked separately.

## 1. Purpose and architecture

The workspace may evolve toward a provider-neutral messaging gateway with distinct adapters for Telegram MTProto, WhatsApp Web (unofficial), and the official WhatsApp Business Platform / Cloud API. Keep adapters isolated: provider-specific authentication, permissions, capabilities, rate limits, delivery semantics, and error handling must not leak into the shared campaign engine.

### Provider boundaries

- **Telegram MTProto:** An authenticated user session may access dialogs and participant information exposed to that account. Visibility depends on entity type, membership, permissions, privacy settings, and Telegram API behavior; do not promise complete rosters or historical/hidden members.
- **WhatsApp Web adapter:** Uses an unofficial web-client library and is fragile to upstream changes. It may access only data exposed by the active, authorized session. It is experimental and is not equivalent to an official API.
- **WhatsApp Cloud API:** Official business messaging API. It is not a general group-member scraper and does not provide arbitrary group-roster extraction. Business-initiated conversations require eligible approved templates and appropriate opt-in; free-form messaging is subject to the customer-service window and current Meta policies.

## 2.1 Implemented initial slice (experimental)

- Durable local consent ledger at `data/consent-ledger.json`, including purpose, source, evidence reference, and effective/recorded timestamps.
- Durable suppression list at `data/suppression-list.json`; suppressed recipients are blocked by campaign preflight and excluded by the existing campaign sender's eligibility filter.
- Audience preflight with duplicate detection, invalid-phone checks, missing-consent checks, opt-out/suppression checks, unresolved template variable reporting, masked phone display, and a clear statement that no messages were sent by preflight.
- Durable campaign drafts at `data/campaign-drafts.json`. Drafts are not automatically sent.
- Authenticated local API routes:
  - `GET /api/experimental/campaigns` — list drafts without message bodies.
  - `POST /api/experimental/campaigns` — create a draft (`title`, `message`, optional `purpose`, `channel`).
  - `POST /api/experimental/campaigns/preflight` — check supplied `contacts` or saved contacts using `message` and optional `campaignId`.
  - `POST /api/experimental/consent` — record `phone`, boolean `consent`, and for consent=true, `purpose`, `source`, `evidenceRef`.
  - `POST /api/experimental/suppressions` — suppress `phone` with optional `reason`.
  - `POST /api/experimental/suppressions/remove` — requires `phone` and exact confirmation `CONFIRM RECONSENT`; do not use unless fresh consent has actually been obtained.
- These routes require the existing API token and follow the server's existing authentication/security middleware. Data is local JSON storage, not encrypted at rest; protect the device and data directory.

## 2.2 Implemented Cloud API and delivery queue slice

- `src/36-whatsapp-cloud-api.js` provides an opt-in adapter for approved WhatsApp Cloud API templates, webhook signature validation, webhook challenge validation, and parsing inbound-message/delivery-status events.
- `src/37-durable-delivery-queue.js` provides local durable queue storage, idempotency keys, bounded retries, exponential backoff, concurrency capped at five, pause/resume/stop controls, and status summaries.
- Authenticated local routes expose Cloud API status, explicit enable/disable, purpose-consent-checked template queueing, processing, and queue controls. Queue processing rechecks consent and suppression immediately before calling the provider.
- The mobile workspace includes a Cloud API panel to inspect configuration/queue state, queue a template for a consented recipient, and control processing.
- Required server environment variables: `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, and `WHATSAPP_CLOUD_APP_SECRET`. Configure only through the local server environment; never paste tokens into campaign data.
- The Cloud API adapter sends approved templates only. It does not scrape WhatsApp groups or bypass provider policies. Meta app webhook delivery requires an externally reachable HTTPS endpoint and the platform's webhook configuration; the current adapter's verification/parser functions are available, but a public inbound webhook endpoint/reverse-proxy deployment is not yet configured by this project.
- Delivery queue payloads are stored in local JSON and are not encrypted at rest. Protect the device and data directory. Provider acceptance is recorded separately from actual delivery; signed Cloud API status webhooks can update accepted queue items to delivered/failed. The server binds to loopback, so Meta webhook traffic requires a deliberately configured HTTPS reverse proxy/tunnel to `/webhooks/whatsapp-cloud` plus `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN`; do not expose the local server directly to the public internet.
- Tests are included in `test/27-cloud-delivery-tests.js` and run in CI. Do not consider real provider delivery verified until valid Meta credentials, an approved template, and an opted-in test recipient have been used in a controlled test.

## 2. Experimental feature sections

### 2.1 Audience and participant data

- Export participant/contact metadata only where the authenticated account is authorized to access it.
- Support CSV and JSON exports, stable IDs, deduplication, source provenance, export timestamps, and schema versions.
- Treat Telegram `access_hash`, session files, WhatsApp credentials, phone numbers, and identifiers as sensitive data. Never place session secrets in exports by default.
- Minimize fields; provide configurable retention, local encryption, access controls, and an audit record for exports.
- Phone-number availability is provider- and privacy-dependent. Do not infer or fabricate numbers for participants whose number is not exposed.
- For WhatsApp group members, show a number only when the active library/session actually exposes it and the operator is authorized to use it. Cloud API must not be presented as a way to scrape arbitrary groups.

### 2.2 Audience hygiene and consent

- Maintain a consent ledger with source, timestamp, purpose, and evidence reference.
- Imported contacts default to not eligible until consent is reviewed.
- Enforce suppression lists and opt-outs at send time, not just at import time.
- Deduplicate using normalized phone numbers or provider IDs without merging distinct people on name alone.
- Provide preview, dry-run, audience counts, invalid-recipient reports, and a final campaign confirmation step.
- Support individualized greetings and files only for recipients who are eligible and have a valid messaging basis.

### 2.3 Campaign engine

- Personalization variables such as `{name}` should be validated and escaped for the chosen message format.
- Optional content variants and A/B tests must be used for legitimate content testing, not to disguise unsolicited spam or evade platform detection.
- Scheduling, per-account limits, bounded concurrency, and rate controls should be configurable and conservative.
- Add a kill switch, pause/resume, cancellation, durable progress checkpoints, idempotency keys, bounded retries, and a dead-letter queue.
- Never retry a permanent rejection indefinitely. Honor provider retry-after signals and documented limits.
- Record attempted, accepted, sent, delivered, read, failed, and unknown states separately. A successful API call or returned message object is not proof of delivery.

### 2.4 Telegram adapter — experimental

Potential modules:
- Authenticated account connection and encrypted session storage.
- Dialog and entity discovery within the session's permitted access.
- Participant export when the provider exposes the roster to the account.
- Message history search with explicit scope, bounded limits, and provenance.
- Media download/export where permitted.
- Explicit single-recipient or approved-audience messaging with consent checks.
- Provider error mapping, FloodWait handling, audit logs, and resumable read-only exports.

Do not implement unsolicited bulk group additions, stranger-DM automation, account rotation intended to bypass restrictions, or suppression of platform service notifications. No fixed daily stranger-message limit should be hard-coded from informal estimates; validate current official documentation and observed API responses.

### 2.5 WhatsApp Web adapter — experimental and unofficial

Potential modules:
- Explicitly connected account status and QR authentication.
- Group discovery and participant metadata only as exposed by the active session/library.
- Read-only export with clear availability markers for unavailable fields.
- Local session isolation, encryption at rest, session deletion/revocation controls, and diagnostic reporting.
- Safe restart recovery and version-compatibility tests for the upstream library.

This adapter must not inject undocumented internals as if they were stable public APIs. Avoid claims that a specific DOM node count or internal object is universal. Do not add stealth fingerprinting, proxy rotation, device impersonation, simulated human behavior, or other mechanisms designed to defeat platform enforcement.

### 2.6 WhatsApp Cloud API adapter — official path

Potential modules:
- Business phone-number and token configuration through encrypted server-side secret storage.
- Approved template selection and variable validation.
- Opt-in evidence, opt-out processing, template/language validation, and customer-service-window checks.
- Webhook verification and processing for delivery/status events.
- Documented throughput and error handling, including bounded backoff for retryable responses such as rate-limit errors.
- Health checks, token expiry diagnostics, message-cost/usage reporting where available, and per-business audit logs.

Throughput, messaging tiers, endpoint versions, and policy requirements change. Treat all numerical limits in older notes as **unverified until checked against current Meta documentation and the actual account's limits**. Never promise 80 or 1,000 messages per second as a universal entitlement.

### 2.7 Reliability and observability

- Structured audit events for login, data access/export, campaign creation, send attempts, opt-outs, retries, and configuration changes.
- Correlation IDs across campaign, recipient, provider request, and webhook event.
- Redaction of credentials, message bodies, and personal data from logs unless explicitly required and access-controlled.
- Metrics for queue depth, provider latency, failure categories, delivery-state lag, retries, and consent/suppression rejections.
- Circuit breakers and bounded retry budgets; distinguish transient, permanent, authorization, policy, and unknown errors.
- Readiness diagnostics must report verified facts rather than infer that a connected account can send successfully.

### 2.8 Multi-account and tenancy controls

- Separate each authorized account's credentials, session files, data, campaign queue, and audit trail.
- Use role-based access (owner/admin/operator/viewer), least privilege, and explicit account ownership.
- Encrypt secrets at rest; never commit tokens, session files, API hashes, or private recipient exports.
- Proxy configuration may be documented only for legitimate network connectivity and privacy needs. It must not be used to rotate identities or evade rate limits or enforcement.
- Add backup/restore tests, retention settings, and account/session revocation procedures before production use.

## 3. Explicit non-goals

The project will not implement or advertise:
- Unsolicited bulk additions to groups or mass direct messages to strangers.
- Proxy-per-account rotation, residential-proxy sourcing, browser fingerprint spoofing, or device impersonation to bypass platform controls.
- “Human-like” typing/read-receipt simulation intended to avoid detection.
- Automatic deletion of platform service messages to conceal bulk operations.
- Unverified promises such as “10 million users per run,” guaranteed access hashes, universal group-roster visibility, fixed anti-ban thresholds, or guaranteed delivery.
- Scraping arbitrary WhatsApp groups through the official Cloud API.

## 4. Verification plan

Each experimental feature must move through these stages:

1. **Documented:** architecture and constraints recorded; no implementation implied.
2. **Implemented:** code and capability flags exist on a feature branch.
3. **Unit-tested:** input validation, permissions, privacy boundaries, retries, and exports have tests.
4. **Integration-tested:** mocked/provider sandbox tests pass; no unsolicited messages are sent.
5. **Live-verified:** only after a separately authorized test account and opted-in test recipients are used.
6. **Production-ready:** security review, retention/consent review, rollback plan, and platform-policy review completed.

CI should test provider-independent logic without requiring real credentials. Tests must prove that opt-outs and suppressed recipients cannot be sent to, retries are bounded, exports redact secrets, and unavailable provider fields remain empty rather than fabricated.

## 5. Acceptance checklist

- [ ] Experimental features are clearly labeled and disabled by default until implemented and verified.
- [ ] Consent and suppression are enforced at the final send boundary.
- [ ] Provider capabilities are discovered or declared explicitly; unsupported actions return a clear error.
- [ ] Session secrets and API credentials are encrypted and excluded from logs/exports.
- [ ] Data access and exports are audited.
- [ ] Retries, rate limits, and campaign concurrency are bounded.
- [ ] Cloud API templates, opt-in, webhooks, and customer-service windows are validated.
- [ ] Telegram and WhatsApp Web limitations are accurately surfaced in the UI.
- [ ] Tests and live verification status are reported separately.
