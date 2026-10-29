# WA Workspace Android wrapper

The Android APK is a WebView client for the existing Node.js service at `http://127.0.0.1:8787/`. It is **not a standalone WhatsApp automation runtime**: `whatsapp-web.js` depends on Node.js and a compatible Chromium/Puppeteer environment, so the server and authenticated session stay in Termux (or an explicitly configured server deployment). The APK does not replace or delete the project or its persistent data.

## Build and install

The GitHub Actions workflow **Android APK** builds a debug APK and uploads it as the artifact `neww`. Open the repository Actions page, select the latest successful Android APK run, download the artifact ZIP, extract it, and install `neww.apk`.

## Run on Android

1. Install Termux from its official F-Droid or GitHub distribution.
2. In Termux, run once:
   ```bash
   cd ~/Whatsapp-scrapper
   bash scripts/termux-setup.sh
   bash scripts/termux-service.sh start
   ```
3. Open WA Workspace. It connects to `http://127.0.0.1:8787/`.
4. If the server is stopped, use **Start server in Termux** in the APK. If Termux blocks external commands, enable **Allow external apps** in Termux settings, then retry.
5. Diagnose startup with:
   ```bash
   bash scripts/termux-service.sh status
   bash scripts/termux-service.sh logs
   ```

The APK's retry control now retries the local endpoint after requesting Termux startup. A successful Android build does not prove WhatsApp QR login or message delivery works on a physical phone; those require device-level testing with a real authorized account.

## Data and package identity

The existing app ID is `com.galaxyuniversity.waworkspace.v121`, version name `1.2.1`, version code `4`. Do not clear Termux data or delete `~/.whatsapp-scrapper` when updating. A normal Android in-place update requires the same application ID and signing certificate; a differently signed debug APK may need to be installed alongside the existing app or signed consistently.
