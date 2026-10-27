# WhatsApp Scrapper Android APK client

This Android app packages the existing web workspace in a native Android WebView. It does **not** pretend that the desktop Electron/Chromium Node.js backend can run inside a normal APK.

## Supported connection modes

1. **Same-phone Termux service:** install/run the existing project in Termux, then start its server with `npm run termux`. The default URL is `http://127.0.0.1:8787/`.
2. **Remote server:** deploy the existing Node.js service on a trusted HTTPS host and enter its HTTPS URL in the app's address field. The app remembers the URL.

For local mode, the Node service must remain running in Termux. The APK is a mobile client, not a replacement for the backend process. WhatsApp Web QR/browser automation still depends on a compatible Chromium runtime; validate account authentication on the chosen backend before relying on campaigns.

## Build

The repository's GitHub Actions workflow builds a debug APK on a hosted Android build runner and uploads it as an artifact. Open **Actions → Android APK Build → Run workflow**, wait for success, then download the `whatsapp-scrapper-android-debug-apk` artifact and extract the APK.

The APK is unsigned for Play Store release (Android debug-signed build). A production release requires a separately managed signing key; never commit keystore files or passwords.

## Security

- Remote HTTP URLs are rejected; use HTTPS for remote deployments.
- HTTP is allowed only for localhost addresses.
- The web UI's existing API-token authorization remains in the Node service.
- Use only a server and WhatsApp account you are authorized to operate.
