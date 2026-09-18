# WhatsApp Scrapper — Professional 3.1 Data Suite

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
- Realtime edit and revoke notifications in the UI.

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

## Data and privacy boundary

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
