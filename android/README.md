# WhatsApp Scrapper Android APK client

This Android app packages the existing web workspace in a native Android WebView. It does **not** pretend that the desktop Electron/Chromium Node.js backend can run inside a normal APK.

## Supported connection modes

### 1. Standalone mode — no Termux or custom server

From the app home screen, tap **إرسال رسمي بدون Termux** to open the native WhatsApp Business Cloud API sender. It calls Meta's HTTPS Graph API directly from Android; it does not require the Node backend, Chromium, Puppeteer, or Termux.

Required: a configured WhatsApp Business Platform account, a valid Phone Number ID, an access token with the required messaging permission, internet access, and a recipient you are authorized to message. The token is entered at send time, is not written to app preferences, and is cleared from the field after Meta accepts a send request. Do not share screenshots containing credentials.

This mode sends plain-text messages through the official business API only. It is **not** a replacement for personal-account QR login, the existing web automation, Telegram tools, campaigns/CRM, or other backend-only features. Outside the permitted customer-service window, use an approved template where required. An HTTP 2xx response means Meta accepted the request; it does not prove final delivery. See [Meta's official Messages endpoint reference](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages) and [WhatsApp Business Developer Hub](https://whatsappbusiness.com/developers/developer-hub/).

### 2. Existing workspace with Termux

The original web workspace and personal WhatsApp Web automation still use the existing Node.js backend. The APK's WebView can connect to that local service at `http://127.0.0.1:8787/`.

### 3. Existing workspace with a remote backend

Deploy the existing Node.js service on a trusted HTTPS host and enter its HTTPS URL in the app's address field. The app remembers the URL.

1. **Same-phone Termux service:** install/run the existing project in Termux, then start its server with `npm run termux`. The default URL is `http://127.0.0.1:8787/`.
2. **Remote server:** deploy the existing Node.js service on a trusted HTTPS host and enter its HTTPS URL in the app's address field. The app remembers the URL.

For the existing workspace, the Node service must remain running in Termux or on a remote host. The standalone Cloud API sender is the no-Termux option, but its supported scope is limited to official WhatsApp Business text messaging.

## Build

The repository's GitHub Actions workflow builds a debug APK on a hosted Android build runner and uploads it as an artifact. Open **Actions → Android APK Build → Run workflow**, wait for success, then download the `whatsapp-scrapper-android-debug-apk` artifact and extract the APK.

The APK is unsigned for Play Store release (Android debug-signed build). A production release requires a separately managed signing key; never commit keystore files or passwords.

## Functional verification status

The CI build confirms that the Android project compiles, the APK is packaged, and source-level checks find the standalone Cloud API route. It does not by itself prove WhatsApp login, QR authentication, message delivery, or Chromium compatibility on a particular phone.

The Android client now handles HTTP Basic Authentication challenges from protected servers with a native login dialog. Credentials are held by WebView's HTTP-auth handling; the app does not write the entered password to its own preferences. For a remote server, configure a strong `WA_ADMIN_USER` and `WA_ADMIN_PASSWORD`, deploy behind HTTPS, and never reuse the WhatsApp account password as the server password.

### Standalone Cloud API smoke test

1. Open the app and tap **إرسال رسمي بدون Termux**.
2. Enter the Phone Number ID and access token from your WhatsApp Business Platform setup, the recipient number with country code, and a short test message.
3. Send only to a consenting test recipient. Confirm the response and then verify the message in WhatsApp / WhatsApp Manager. Do not interpret an accepted API request as delivery confirmation.
4. If Meta rejects the request, check the returned error, token permissions, phone-number ID, recipient eligibility, and template/customer-service-window rules.

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
