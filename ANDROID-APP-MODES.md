# Android APK runtime modes

The Android APK packages the existing `src/web/` interface into its assets and attempts to connect to the local Node.js service at `http://127.0.0.1:8787/` first.

## Available modes

1. **Local Termux mode:** start the existing service from the app's fallback screen or from Termux. WhatsApp Web automation depends on the Node.js backend and a compatible Chromium/Puppeteer runtime.
2. **Bundled interface fallback:** if the local service cannot be reached, the APK opens the bundled web UI so the app does not stop at a blank screen. Browser-side presentation and browser storage may work, but endpoints under `/api/`, WhatsApp Web session automation, and other backend features are not available without a running backend. This fallback is not a full standalone replacement for Node.js.
3. **Cloud mode:** choose **Connect cloud server** from the fallback screen and enter the HTTPS URL of a deployed instance of this same application. The URL is stored in Android app preferences and loaded in the WebView. The server must be deployed, reachable, and configured correctly.

## Build

The GitHub Actions workflow copies all files from `src/web/` to `android/app/src/main/assets/` before running `gradle assembleDebug`. It uploads the resulting debug APK as the `neww` artifact. Artifacts are temporary (14-day retention); they are not a permanent release.

## Important limitations and security

- Packaging HTML/CSS/JavaScript does not package or emulate the Node.js server, Chromium, or Puppeteer. A truly standalone APK with the complete WhatsApp Web automation stack would require a separately engineered Android-compatible backend/runtime and must be tested on physical devices.
- The bundled interface keeps the existing application UI rather than replacing it with a smaller demo page, so existing features are not silently removed.
- Do not put production API tokens in a static HTML file or treat browser `localStorage` as a secure secret vault. Use server-side secret storage for production credentials.
- Verify the APK on a real Android device, including file import, local-storage persistence, cloud TLS/CORS/authentication, Termux service startup, and WhatsApp session behavior before calling the release production-ready.
