# WA Workspace Android wrapper

This Android WebView app opens the existing local Node.js application at `http://127.0.0.1:8787/`. It does not bundle Node.js, Chromium, or WhatsApp automation; the server and session remain in Termux.

## Build and install

The GitHub Actions workflow **Android APK** builds a debug APK and uploads it as `wa-workspace-debug-apk`. Open the repository Actions page, select a successful Android APK run, download the artifact ZIP, extract it, and install `app-debug.apk`.

## Run

1. In Termux: `cd ~/Whatsapp-scrapper && bash scripts/termux-service.sh start`
2. Open WA Workspace. Keep Termux running in the background.
3. If the server is stopped, start it in Termux and tap Retry in the app.

The APK package ID is `com.galaxyuniversity.waworkspace`, version name `1.2.0`, version code `3`.

Note: a higher version code permits a normal upgrade only when the APK is signed with the same signing certificate as the installed app. A GitHub-hosted debug build may use a different debug key on a different runner, which can still cause Android to reject an in-place update. Do not clear Termux data or delete `~/.whatsapp-scrapper`.
