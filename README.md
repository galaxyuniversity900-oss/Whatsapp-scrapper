# WhatsApp Scrapper — Professional 3.2 Data Suite

A Termux-first local messaging workspace for Android, with optional Electron desktop support and consent-based WhatsApp campaigns.

> **Runtime priority:** Termux/local WhatsApp Web is the primary runtime. WhatsApp Cloud API is an optional emergency/fallback adapter only; the app must not select it automatically or require Meta credentials for normal Termux operation. See [Professional Messaging Engineering Features](docs/EXPERIMENTAL_MESSAGING_ENGINEERING.md). The consent ledger, suppression list, campaign preflight and draft storage are local. Telegram campaign orchestration and end-to-end production verification remain incomplete.

## Features
- Multiple WhatsApp Web sessions using `whatsapp-web.js` + `LocalAuth`.
- QR authentication and session status.
- Pending / sent / failed contact tracking.
- CSV and JSON contact import.
- Explicit consent gate: only `consent: true` contacts are campaign-eligible.
- Ten message templates (M1–M10) with `{name}` and `{phone}` variables.
- Optional image/audio/video attachment.
- Pause / resume / stop controls.
- Configurable randomized delivery interval and per-account cap.
- Headless browser option.
- Local data storage under Electron's user-data directory.
- Account Readiness diagnostics instead of automated fake conversations or enforcement-evasion behavior.
- Delivery monitor with message ACK lifecycle and local delivery history.
- Persistent account registry with correct LocalAuth session lifecycle.
- Durable campaign scheduler with cancellation and restart recovery.
- JSONL audit trail and operational event history.
- Circuit breaker for consecutive send failures.
- Multi-file media selection for image/audio/video campaigns.
- Professional dashboard queues, delivery table and reliability controls.
- Realtime message collection via the upstream `message_create` event for private chats and groups, with local JSONL storage.
- On-demand chat history synchronization with configurable message limits.
- Contact directory synchronization with WhatsApp registration state, name, push name, business flags, about text and profile-picture URL when permitted by privacy settings.
- Business profile fields are captured only when exposed by the active WhatsApp Web account/library; unavailable fields remain empty rather than being fabricated.
- Group discovery and member metadata including IDs, phone numbers when available, names and admin flags.
- Number validation through the connected account plus optional profile-picture availability check.
- Local message search and dataset summaries.
- One-click exports to Excel-compatible `.xls` (SpreadsheetML), CSV, JSON, XML, HTML, JSONL, RSS and TXT.
- Optional network proxy configuration for legitimate connectivity requirements; authenticated proxy credentials are held for the session and are not written to the settings file.
- Channel subscriber discovery is supported only for subscribers visible to the connected account/library.
- Realtime edit and revoke notifications in the UI.\n- Selectable Person / Group Intelligence: for a chosen number, analyze who added the number to groups, how many distinct groups the number appears in, how many messages the number sent, and how many reactions those messages received. Each metric can be enabled independently to reduce work.

## Optional fallback only: WhatsApp Cloud API and delivery queue

**Do not use Cloud API for normal sending.** The primary workflow is the Termux-hosted local runtime using the connected WhatsApp Web session. Cloud API remains disabled by default and is reserved for an explicitly chosen fallback only. It is not required to install, launch, or use the core Termux workflow. The local server exposes authenticated Cloud API routes solely for this optional fallback; it must never be selected automatically.

Only if deliberately switching to the fallback, configure these environment variables in the server runtime:
- `WHATSAPP_CLOUD_TOKEN`
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_APP_SECRET`
- `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN` (for webhook verification)

The Termux local workflow does not require a public webhook or Meta credentials. The optional Cloud API fallback binds through the same loopback server; receiving Meta webhooks would require a deliberately configured HTTPS reverse proxy/tunnel, which is not part of the default Termux setup. Do not expose the local server directly. Queue, consent and draft files are local JSON and are not encrypted at rest. Real provider delivery is not verified until tested with valid credentials, an approved template and a recipient who opted in.

## Run
```bash
npm install
npm start
```

## Contact JSON
```json
[
  {"phone":"201000000000","name":"Customer","consent":true,"status":"pending"}
]
```

CSV imports default to `consent: false`; review and enable consent in the Clients screen before sending.

## Person / Group Intelligence\n\nThe **Person Intelligence** screen accepts one phone number and four independent metrics: **who added the number**, **distinct groups encountered**, **message count**, and **reaction count on that person's messages**. The scan is limited by a configurable messages-per-group value. Add events are derived from WhatsApp group notifications/history exposed to the connected session; reaction totals use the library's reaction metadata when available. Results are explicitly marked as based on the data accessible to the connected account.\n\n## Data and privacy boundary

The data suite is designed for accounts the operator is authorized to access. It does not bypass WhatsApp privacy controls, scrape data that is not exposed to the connected account, or provide a mechanism to evade platform enforcement. Profile-picture and About retrieval can return no data when WhatsApp privacy settings do not permit it. Group/channel discovery is limited to objects and participant/subscriber data exposed by the current WhatsApp Web session. Exports are written locally by the desktop application.

## Safety
This project is intended for legitimate, consent-based communications. It does not implement techniques intended to bypass platform enforcement, spoof users, or manufacture engagement. Randomized delays are a scheduling control, not a guarantee against restrictions.

## Architecture
`src/main.js` owns Electron IPC, WhatsApp sessions, campaign execution and local persistence. `src/8-delivery-tracker.js` records send/ACK lifecycle. `src/9-account-registry.js` manages durable account metadata. `src/preload.js` exposes a minimal isolated API. `src/renderer/` contains the UI.

## License
MIT


## Core testing on Termux

The Electron desktop UI is Windows/macOS/Linux desktop software and cannot be launched as an Android/Termux Electron desktop application. Termux can, however, run the platform-independent campaign core tests.

```bash
pkg update
pkg install nodejs-lts
git clone https://github.com/galaxyuniversity900-oss/Whatsapp-scrapper.git
cd Whatsapp-scrapper
npm install --ignore-scripts
npm run termux:test
```

The Termux smoke test validates JavaScript syntax, state persistence, bounded concurrency, retry handling, browser detection logic, campaign-manager integration, delivery tracking, account registry, realtime data collection and all supported export writers. It does not authenticate or send messages through WhatsApp Web. It does not authenticate or send messages through WhatsApp Web.

## Production reliability notes

The project pins `whatsapp-web.js` to the tested 1.34.7 release rather than using a floating dependency. The runtime records the message returned by `sendMessage()` separately from subsequent `message_ack` events, because a returned message object is not by itself proof of final delivery. The upstream library exposes `message_ack`, `authenticated`, `ready`, `change_state`, `auth_failure`, and `disconnected` events for this lifecycle. See the upstream documentation before upgrading the dependency.

## Real WhatsApp account test

For the actual QR account test, run the desktop application on Windows/macOS/Linux:

```bash
npm install
npm start
```

Then open **Accounts → Add / Connect**, choose a browser, and scan the displayed QR code from WhatsApp Linked Devices. Only use recipients who have explicitly opted in.


## Telegram Adapter 5.1

The project now includes a **Telegram Adapter** backed by the maintained `teleproto` MTProto client. The adapter is a provider-neutral boundary: the UI/API talks to one consistent interface while the Telegram-specific implementation handles authentication, dialogs, public discovery, message history, media download and exports. This makes it possible to add future providers without rewriting the desktop workspace.

### Telegram tools
- Account login with API ID/API hash + phone code + optional Telegram 2FA.
- Encrypted local Telegram StringSession storage using the app's local master key.
- Saved-session restore on later launches.
- Public channel/group search.
- Authorized-account dialog listing.
- Message history extraction with text search, limits and ordering.
- Public-member listing only for entities with a public username.
- Entity resolution and metadata.
- Media download by selected message.
- JSON/CSV/XLS/HTML/XML/JSONL/RSS/TXT exports.
- Explicit single-target message sending from the operator UI.
- Adapter capability discovery.
- Audit events for connection, public search, public-member listing and explicit sends.

The Telegram layer intentionally does not bypass private/invite-only access controls or implement bulk-DM/anti-spam-evasion behavior.

### Windows local service

The Electron desktop app now starts `src/server.js` as a **hidden Electron Utility Process** bound to `127.0.0.1:8787`. The service is not exposed publicly and is started automatically whenever the desktop application starts. Its data directory is aligned with Electron's user-data directory, and a local master key is generated once for encrypted Telegram/Cloud secrets. The service is terminated cleanly when the application exits.

This follows Electron's UtilityProcess model for running a Node.js child service from the main process. The process has no visible command window in normal Windows operation.

### Telegram API credentials

Telegram MTProto requires an `api_id` and `api_hash` obtained from Telegram's developer portal. The saved session string is equivalent to a long-lived login credential and must be treated as a secret.


## AI Provider Hub 5.2

The desktop platform now has a unified AI layer that can connect local LLM runtimes and cloud/gateway APIs without coupling WhatsApp or Telegram features to a single model vendor.

### Local LLM support

The Hub can detect and connect to OpenAI-compatible local servers such as:
- Ollama: `http://127.0.0.1:11434/v1`
- LM Studio: `http://127.0.0.1:1234/v1`
- vLLM: `http://127.0.0.1:8000/v1`
- llama.cpp server: `http://127.0.0.1:8080/v1`

LM Studio officially exposes OpenAI-compatible endpoints and a local REST API, including model listing and tool/MCP capabilities. citeturn0search0turn0search4

### 30-model catalog

The Hub ships with 30 model profiles spanning OpenAI, Anthropic, Google, DeepSeek, xAI, Mistral, Meta/Llama, Qwen, Cohere, Perplexity, Groq, Cerebras, Together, Fireworks, NVIDIA NIM, Hugging Face, Replicate, OpenRouter and local runtimes. The catalog is a capability/connection catalog; actual model availability is discovered from the configured provider rather than assumed.

OpenRouter can expose hundreds of models through one OpenAI-compatible API and provides a `/v1/models` endpoint, so the Hub can use its live model catalog in addition to the built-in profiles. citeturn0search1turn0search2

### UniKey gateway

UniKey is supported as a first-class preset using its OpenAI-compatible API:
- Base URL: `https://www.getunikey.ai/v1`
- Authentication: Bearer API key
- Model discovery: `GET /v1/models`
- Chat: `POST /v1/chat/completions`

UniKey's documentation explicitly describes OpenAI-compatible model APIs and a unified gateway for multiple model families. citeturn1search0turn1search1

### AI use across the platform

The same AI Hub can be used as the capability layer for:
- WhatsApp conversation classification and summaries.
- Telegram message/channel analysis.
- CRM/customer summaries and notes.
- Contact segmentation assistance.
- Campaign/template drafting.
- Group intelligence summaries.
- Search and research assistance.
- Developer/code assistance.
- Future image/audio/video model adapters.
- Multi-provider comparison and fallback routing.

API keys are stored encrypted in the local AI provider store; they are never rendered back to the UI. The application keeps operator/consent controls around actual messaging actions.

## Production Hardening 5.3

The 5.3 hardening layer adds a provider-neutral AI capability foundation with explicit task validation, provider policy enforcement, health checks, bounded fallback/compare operations, request timeouts and audit hooks. Capability execution remains side-effect free with respect to WhatsApp/Telegram messaging.

The local HTTP service is protected by an installation-specific API token. The web console obtains the token from its same-origin security endpoint and sends it as X-API-Key; Server-Sent Events use the same token as a query credential because native EventSource cannot set custom headers. Cross-origin access is restricted by default to the local service origin and can be explicitly configured with WA_ALLOWED_ORIGINS.

AI provider credentials and Cloud API secrets use installation-specific encryption keys when an explicit AI_MASTER_KEY / WA_MASTER_KEY is not supplied. Provider URLs are validated to HTTP/HTTPS without embedded credentials, and AI model discovery/chat requests have bounded timeouts.

The full test suite now includes capability and production-hardening regression tests, and the Windows packaging workflow remains part of CI.

## Full web deployment (Docker + Render)

The existing web dashboard is served by the Node.js server at `src/web/index.html`; this is the operational UI, not a separate mockup. GitHub stores the source and CI checks the deployment configuration. GitHub Pages alone cannot run this Node.js API, WhatsApp sessions, or persistent background processes.

### Deploy from GitHub

1. Push/merge this branch after reviewing its pull request.
2. In Render, create a new **Blueprint** and connect this repository. Render reads `render.yaml` and builds the `Dockerfile`.
3. Wait for the first deployment, then open the generated service URL.
4. In the Render service environment, retrieve or rotate `WA_ADMIN_PASSWORD` and `WA_API_TOKEN`. The admin page is protected by HTTP Basic Authentication; the default username is `admin`. Change it by setting `WA_ADMIN_USER`.
5. Keep the persistent disk mounted at `/var/data`. WhatsApp authentication sessions and local application data are stored there. Do not remove the disk during redeployments.
6. Pair WhatsApp accounts only after opening the authenticated dashboard. Verify login, QR/pairing, campaign preflight, a small opted-in test audience, and delivery logging before using any real campaign.

### Security and deployment limits

- Production startup fails closed with HTTP 503 if `WA_ADMIN_PASSWORD` is missing.
- `/healthz` is the only unauthenticated route and reveals only a health status.
- Use HTTPS, strong unique admin credentials, and rotate secrets if they are exposed. Never put secrets in Git or browser code.
- WhatsApp Web sessions can be fragile in container environments and may require re-pairing. Test the actual deployment; a green container health check does not prove WhatsApp connectivity.
- A public Render service is not deployed merely by adding these files. A repository owner must connect/authorize the service in Render and review its generated secrets and billing plan.
- For production use, contact recipients only with appropriate consent and honor opt-outs.

### Local run

```bash
npm install
npm run server
```

The local server defaults to `http://127.0.0.1:8787`. For local development, admin Basic Authentication is optional; production mode requires `WA_ADMIN_PASSWORD`.

## Android / Termux local runtime

For the local web application on Android, follow [TERMUX.md](TERMUX.md). The local Termux runtime is primary and binds the server only to `127.0.0.1:8787`; WhatsApp Cloud API remains an optional fallback that is disabled by default and is not required for normal startup. It uses Chromium and a local WhatsApp Web session; it does not require Browserless or a remote browser service.

Quick start from the repository folder:

```bash
pkg install nodejs-lts chromium
export PUPPETEER_SKIP_DOWNLOAD=1
npm install --omit=dev
bash scripts/termux-start.sh
```

Open `http://127.0.0.1:8787` in the phone browser and keep Termux running. Use `npm run termux:local` to run the local-only and core smoke checks. QR login and actual message delivery still need to be verified on the device.

