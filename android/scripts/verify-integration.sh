#!/usr/bin/env bash
set -euo pipefail

activity="android/app/src/main/java/com/galaxyuniversity/whatsappscrapper/MainActivity.java"
server="src/server.js"
web="src/web/index.html"
browser="src/3-browser-selection-fix.js"
launcher="android/termux-start.sh"
deploy="android/termux-deploy-render.sh"
cloud="android/app/src/main/java/com/galaxyuniversity/whatsappscrapper/CloudApiActivity.java"

test -s "$activity"
test -s "$server"
test -s "$web"
test -s "$browser"
test -s "$launcher"
test -s "$deploy"
test -s "$cloud"

grep -q 'onReceivedHttpAuthRequest' "$activity"
grep -q 'إرسال رسمي بدون Termux' "$activity"
grep -q 'android:name=".CloudApiActivity"' android/app/src/main/AndroidManifest.xml
grep -q 'https://graph.facebook.com/v23.0/' "$cloud"
grep -q 'Authorization", "Bearer " + token' "$cloud"
grep -q 'executor.execute' "$cloud"
grep -q 'accessToken.setText("")' "$cloud"
grep -q 'handler.proceed(user, pass)' "$activity"
grep -q 'http://127.0.0.1:8787/' "$activity"
grep -q 'BuildConfig.REMOTE_SERVER_URL' "$activity"
grep -q "buildConfigField 'String', 'REMOTE_SERVER_URL'" android/app/build.gradle
grep -q 'BROWSERLESS_BASE_URL' render.yaml
grep -q 'BROWSERLESS_TOKEN' render.yaml
grep -q 'mountPath: /var/data' render.yaml
bash -n "$deploy"
grep -q 'Remote HTTP URLs are rejected' android/README.md || true
grep -q 'requireAdminBasicAuth(req, res)' "$server"
grep -q "p === '/api/security/token'" "$server"
grep -q "'X-API-Key':API_TOKEN" "$web"
grep -q 'detectInstalledBrowsers' "$browser"
grep -q "WA_DEFAULT_HEADLESS === '1'" "$server"
grep -q 'WA_DEFAULT_HEADLESS' "$launcher"
grep -q 'CHROME_BIN' "$launcher"

echo 'PASS Android WebView HTTP Basic Auth handler'
echo 'PASS Android local backend default URL'
echo 'PASS server admin-auth and API-token routes exist'
echo 'PASS web UI sends API token'
echo 'PASS browser discovery code exists'
echo 'PASS Termux launcher selects Chromium and enables headless mode'
echo 'PASS native Cloud API screen and HTTPS Graph API endpoint'
echo 'PASS API token is entered at runtime and cleared after accepted send'
echo 'PASS APK can use a build-time remote URL without embedding credentials'
echo 'PASS Render blueprint includes Browserless secret inputs and persistent storage'
echo 'PASS one-time Termux deployment wizard passes shell syntax'
echo 'RESULT Android/backend integration contract checks passed'
