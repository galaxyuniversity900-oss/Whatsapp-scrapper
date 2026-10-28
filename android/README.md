# WA Workspace Android wrapper

This is a native Android WebView shell for the existing local Node.js application. It loads only `http://127.0.0.1:8787/`; it does not bundle Node.js, Chromium, or WhatsApp Web automation. The server and WhatsApp session remain in Termux, so the app and Termux share the same Android device loopback.

## Build APK

The GitHub Actions workflow **Android APK** builds a debug APK. Open the repository's Actions tab, select a successful **Android APK** run, and download the `wa-workspace-debug-apk` artifact. Extract the ZIP and install `app-debug.apk`. Debug APKs are for personal testing, not Play Store release.

## Run

1. In Termux, start the existing project server from the repository directory:
   ```sh
   cd ~/Whatsapp-scrapper
   node src/server.js
   ```
   Or use the background command already verified on this device:
   ```sh
   cd ~/Whatsapp-scrapper
   node src/server.js &
   sleep 2
   curl -sS -i http://127.0.0.1:8787/
   ```
2. Open **WA Workspace**. If the server is not running, the app shows a retry screen.
3. Keep Termux alive in the background; Android may stop background processes unless battery restrictions are adjusted.

## Important limitations

- This APK is a UI client, not a standalone replacement for Termux. It does not start or control Termux automatically; Android app sandboxing and background-execution restrictions make that a separate integration.
- It preserves the server-side data location and session state in Termux. Do not clear Termux app data or delete `~/.whatsapp-scrapper` if you need those sessions.
- The app uses cleartext HTTP only for the loopback URL. Do not expose this server on a public network.
- An APK build passing CI proves packaging only. Confirm the actual installation, localhost connection, QR login and account operations on the target phone.
