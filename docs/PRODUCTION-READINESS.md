# Production Readiness and Device Verification

## Current runtime model

This repository has two separate runtime targets:

- The web control panel is served by `node src/server.js` (default local URL: `http://127.0.0.1:8787`).
- The Android/WebView client, if built separately, is a client for that service. It does not itself bundle or start the Node.js/Chromium service. On Android/Termux, keep the service process alive while using the panel.

The default server bind is loopback (`127.0.0.1`). Do not expose the service to a LAN or public network by changing `HOST` unless administrator authentication, API-token handling, HTTPS/reverse-proxy settings, allowed origins, and persistent storage have been reviewed for that deployment.

## Local run

1. Install a supported Node.js runtime and project dependencies in the project directory.
2. Run `npm run lint` and `npm run test:all`.
3. Start the web service with `npm run server`.
4. Open `http://127.0.0.1:8787` on the same device.
5. Follow the administrator authentication prompt if configured, then let the UI initialize its API token.
6. Connect WhatsApp only through the real QR/pairing flow shown by the application. Do not use a production contact list for the first smoke test.

The first dependency install can use mobile data; avoid repeating it unnecessarily on a metered connection.

## Data location and recovery

By default, server-side application data is stored under `~/.whatsapp-scrapper`. If `WA_DATA_DIR` is set, that configured directory becomes the data root. The directory can contain contacts, account registry, WhatsApp authentication state, audit events, delivery records, media, integration settings, and exports.

- Stop the server cleanly before copying the data directory.
- Copy the complete data directory to a separate trusted location and protect it as sensitive information.
- Verify a backup by checking that the copy exists and has non-zero expected data files before deleting or replacing anything.
- Never publish backup archives, WhatsApp session folders, API tokens, secret-store keys, or contact exports in a public repository.
- The platform backup action creates a backup of platform-store data. It is not, by itself, a full backup of every WhatsApp session and all files in the runtime data directory.

A restore should be rehearsed against a separate test data directory before replacing the live directory. Do not overwrite the only copy of the live data.

## Security checklist

- Keep the server bound to loopback for local-only use.
- Use a strong administrator password and keep `WA_API_TOKEN` and `WA_MASTER_KEY` private.
- Use `WA_ALLOWED_ORIGINS` to explicitly limit browser origins when a remote browser is genuinely required; do not set a wildcard origin on an exposed deployment.
- Use HTTPS for remote access and do not send credentials over plain HTTP on an untrusted network.
- Only import contacts with a valid purpose and record of consent. Respect opt-outs and applicable messaging policies.
- Treat logs, exports, backups, browser profiles, and QR/pairing codes as sensitive.
- Recheck permissions and access after deployment or moving the data directory.

## Release validation

Automated GitHub Actions validate syntax, tests, and Windows packaging. They cannot prove that WhatsApp login, QR scanning, message delivery, browser discovery on a specific phone, Android background-process behavior, or restore from a real backup works on every device.

Before calling a release production-ready, complete this manual matrix on the target phone and Windows machine:

- [ ] Open the local dashboard and confirm the service remains reachable.
- [ ] Confirm API authorization succeeds and unauthenticated API requests are rejected.
- [ ] Connect a test WhatsApp account and scan the real QR code.
- [ ] Restart the service and confirm intended account/session recovery.
- [ ] Verify a consented test contact can be imported and an opted-out contact is excluded.
- [ ] Run a dry-run campaign before sending any test message.
- [ ] Create a backup, restore it to a separate data directory, and verify expected records.
- [ ] Check mobile layout, keyboard focus, and reduced-motion behavior.
- [ ] Confirm the service worker registers on localhost/HTTPS and that the UI clearly reports when its API is offline.
- [ ] Verify the generated Windows artifact and, separately, build/test any Android wrapper that is maintained outside this repository.

## Known boundaries

A green CI run is not a physical-device test. This repository's local web service and an Android wrapper are separate deliverables; a public hosting URL or a working APK must not be claimed until the corresponding deployment/build artifact exists and has been tested. The service worker caches only the basic app shell; API actions still require the running service and authorization.
