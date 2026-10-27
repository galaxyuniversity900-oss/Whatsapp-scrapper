# WhatsApp Scrapper Android APK client

This Android app packages the existing web workspace in a native Android WebView. It does **not** pretend that the desktop Electron/Chromium Node.js backend can run inside a normal APK.

## Supported connection modes

1. **Same-phone Termux service:** install/run the existing project in Termux, then start its server with `npm run termux`. The default URL is `http://127.0.0.1:8787/`.
2. **Remote server:** deploy the existing Node.js service on a trusted HTTPS host and enter its HTTPS URL in the app's address field. The app remembers the URL.

For local mode, the Node service must remain running in Termux. The APK is a mobile client, not a replacement for the backend process. WhatsApp Web QR/browser automation still depends on a compatible Chromium runtime; validate account authentication on the chosen backend before relying on campaigns.

## Build

The repository's GitHub Actions workflow builds a debug APK on a hosted Android build runner and uploads it as an artifact. Open **Actions → Android APK Build → Run workflow**, wait for success, then download the `whatsapp-scrapper-android-debug-apk` artifact and extract the APK.

The APK is unsigned for Play Store release (Android debug-signed build). A production release requires a separately managed signing key; never commit keystore files or passwords.

## Functional verification status

The CI build confirms that the Android project compiles and the APK is packaged. It does not by itself prove WhatsApp login, QR authentication, message delivery, or Chromium compatibility on a particular phone.

The Android client now handles HTTP Basic Authentication challenges from protected servers with a native login dialog. Credentials are held by WebView's HTTP-auth handling; the app does not write the entered password to its own preferences. For a remote server, configure a strong `WA_ADMIN_USER` and `WA_ADMIN_PASSWORD`, deploy behind HTTPS, and never reuse the WhatsApp account password as the server password.

### Local Termux smoke test

1. If required, install Termux packages: `pkg install nodejs-lts npm chromium`.
2. In the existing repository directory, run `bash android/termux-start.sh`. The launcher installs runtime dependencies with `npm install --omit=dev` only when missing, detects Chromium, sets `CHROME_BIN`, and enables headless mode by default.
3. Confirm the console reports the local service at `http://127.0.0.1:8787`.
4. Open the APK on the same phone. Keep Termux running while using local mode.
5. Verify the dashboard loads, create/connect an account, scan the QR code, and only then send a single test message to a consenting test recipient.

If QR authentication or session startup fails, check whether the installed Termux Chromium can launch headlessly and whether the version is compatible with the bundled `whatsapp-web.js` / Puppeteer runtime. The APK cannot repair a backend browser-runtime incompatibility.

### CI checks

The Android workflow runs `android/scripts/verify-integration.sh` before building. These are source-level integration-contract checks, not an emulator or live WhatsApp test. A successful workflow must be followed by the on-device smoke test above.

## Security

- Remote HTTP URLs are rejected; use HTTPS for remote deployments.
- HTTP is allowed only for localhost addresses.
- The web UI's existing API-token authorization remains in the Node service.
- Use only a server and WhatsApp account you are authorized to operate.
