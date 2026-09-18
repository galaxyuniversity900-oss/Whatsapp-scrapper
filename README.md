# WhatsApp Scrapper — Professional 3.0

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

The Termux smoke test validates JavaScript syntax, state persistence, bounded concurrency, retry handling, browser detection logic, campaign-manager integration, delivery tracking and account registry behavior. It does not authenticate or send messages through WhatsApp Web.

## Production reliability notes

The project pins `whatsapp-web.js` to the tested 1.34.7 release rather than using a floating dependency. The runtime records the message returned by `sendMessage()` separately from subsequent `message_ack` events, because a returned message object is not by itself proof of final delivery. The upstream library exposes `message_ack`, `authenticated`, `ready`, `change_state`, `auth_failure`, and `disconnected` events for this lifecycle. See the upstream documentation before upgrading the dependency.

## Real WhatsApp account test

For the actual QR account test, run the desktop application on Windows/macOS/Linux:

```bash
npm install
npm start
```

Then open **Accounts → Add / Connect**, choose a browser, and scan the displayed QR code from WhatsApp Linked Devices. Only use recipients who have explicitly opted in.
