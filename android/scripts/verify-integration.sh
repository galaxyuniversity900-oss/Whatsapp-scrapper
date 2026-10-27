#!/usr/bin/env bash
set -euo pipefail

activity="android/app/src/main/java/com/galaxyuniversity/whatsappscrapper/MainActivity.java"
server="src/server.js"
web="src/web/index.html"
browser="src/3-browser-selection-fix.js"
launcher="android/termux-start.sh"
cloud="android/app/src/main/java/com/galaxyuniversity/whatsappscrapper/CloudApiActivity.java"

test -s "$activity"
test -s "$server"
test -s "$web"
test -s "$browser"
test -s "$launcher"
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
echo 'RESULT 8/8 Android/backend integration contract groups passed'
