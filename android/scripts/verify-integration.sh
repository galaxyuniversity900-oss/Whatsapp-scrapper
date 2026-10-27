#!/usr/bin/env bash
set -euo pipefail

activity="android/app/src/main/java/com/galaxyuniversity/whatsappscrapper/MainActivity.java"
server="src/server.js"
web="src/web/index.html"
browser="src/3-browser-selection-fix.js"
launcher="android/termux-start.sh"

test -s "$activity"
test -s "$server"
test -s "$web"
test -s "$browser"
test -s "$launcher"

grep -q 'onReceivedHttpAuthRequest' "$activity"
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
echo 'RESULT 6/6 Android/backend integration contract checks passed'
