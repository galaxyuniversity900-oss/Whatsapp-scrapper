# WhatsApp Scrapper — Professional 3.2 Data Suite

A local Electron desktop workspace for consent-based WhatsApp campaigns.

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
