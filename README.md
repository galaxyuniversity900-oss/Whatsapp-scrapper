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
