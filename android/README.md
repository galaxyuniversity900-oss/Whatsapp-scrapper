# WhatsApp Scrapper Android APK client

This Android app packages the existing web workspace in a native Android WebView. It does **not** pretend that the desktop Electron/Chromium Node.js backend can run inside a normal APK.

## Supported connection modes

### 1. Standalone mode — no Termux or custom server

From the app home screen, tap **إرسال رسمي بدون Termux** to open the native WhatsApp Business Cloud API sender. It calls Meta's HTTPS Graph API directly from Android; it does not require the Node backend, Chromium, Puppeteer, or Termux.

Required: a configured WhatsApp Business Platform account, a valid Phone Number ID, an access token with the required messaging permission, internet access, and a recipient you are authorized to message. The token is entered at send time, is not written to app preferences, and is cleared from the field after Meta accepts a send request. Do not share screenshots containing credentials.

This mode sends plain-text messages through the official business API only. It is **not** a replacement for personal-account QR login, the existing web automation, Telegram tools, campaigns/CRM, or other backend-only features. Outside the permitted customer-service window, use an approved template where required. An HTTP 2xx response means Meta accepted the request; it does not prove final delivery. See [Meta's official Messages endpoint reference](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages) and [WhatsApp Business Developer Hub](https://whatsappbusiness.com/developers/developer-hub/).

### 2. Existing workspace with Termux

The original web workspace and personal WhatsApp Web automation still use the existing Node.js backend. The APK's WebView can connect to that local service at `http://127.0.0.1:8787/`.

### 3. Remote backend — no Termux after setup

Use the one-time Termux deployment wizard in `android/termux-deploy-render.sh`. It validates the checked-out branch and project tests, opens Render's dashboard, and then checks the deployed service's `/healthz` endpoint. It does not store cloud credentials in the APK or commit secrets.

On the first setup, Render account authorization and the Browserless Private Fleet endpoint/token must be entered by you in the provider dashboards; this cannot be done safely without your account authorization.

**One-time Termux setup:**

```bash
pkg update
pkg install git nodejs-lts curl
git clone -b browserless-remote-browser https://github.com/galaxyuniversity900-oss/Whatsapp-scrapper.git
cd Whatsapp-scrapper
bash android/termux-deploy-render.sh
```

In the Render Blueprint flow:
1. Connect this repository and select the `browserless-remote-browser` branch.
2. Review the Starter service and persistent disk pricing before confirming.
3. Set `BROWSERLESS_BASE_URL` to the exact HTTPS endpoint shown in the Browserless Private Fleet dashboard, and `BROWSERLESS_TOKEN` as a Render secret. Never paste either into the APK or source files.
4. Deploy and wait for the service to become Live. Return to Termux and paste the HTTPS service URL when the wizard asks. The script checks `/healthz` and saves the URL locally; a healthy endpoint proves only that the server responds, not that WhatsApp login or message sending works.

**Prepare an APK that opens the remote service by default:** open GitHub Actions → **Android APK Build** → **Run workflow**, enter the deployed HTTPS URL in the optional `server_url` input, and download the `whatsapp-scrapper-android-debug-apk` artifact after the workflow succeeds. The URL is configuration, not a credential. If you install a generic APK instead, enter the URL once in its address field; it remembers the URL.

The APK asks for the server's HTTP Basic Auth credentials when needed. Retrieve `WA_ADMIN_USER` and `WA_ADMIN_PASSWORD` from the Render service configuration; do not use your WhatsApp password. The Node.js backend remains hosted remotely, so Termux can be closed or uninstalled after setup. The hosted service must stay deployed and its persistent disk must remain attached.

The official Cloud API sender remains a separate no-Termux option; it does not replace the WhatsApp Web, Telegram, CRM, or other backend features.

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

### APK build-time remote URL

The Android Gradle build accepts `WA_REMOTE_SERVER_URL` (or `-PwaServerUrl=https://your-service.onrender.com`). It validates that the value is an HTTPS base URL and embeds only that URL, never the admin password, API token, Browserless token, or encryption key. GitHub Actions exposes this as the optional `server_url` input on the Android APK Build workflow.

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
