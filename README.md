# WhatsApp Scrapper

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
- Account Readiness checklist instead of automated fake conversations or enforcement-evasion behavior.

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
`src/main.js` owns Electron IPC, WhatsApp sessions, campaign execution and local persistence. `src/preload.js` exposes a minimal isolated API. `src/renderer/` contains the UI.

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

The Termux smoke test validates JavaScript syntax, state persistence, bounded concurrency, retry handling, browser detection logic, and campaign-manager integration. It does not authenticate or send messages through WhatsApp Web.

## Real WhatsApp account test

For the actual QR account test, run the desktop application on Windows/macOS/Linux:

```bash
npm install
npm start
```

Then open **Accounts → Add / Connect**, choose a browser, and scan the displayed QR code from WhatsApp Linked Devices. Only use recipients who have explicitly opted in.
