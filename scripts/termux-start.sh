#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PUPPETEER_SKIP_DOWNLOAD=1
if command -v chromium >/dev/null 2>&1; then export CHROME_BIN="$(command -v chromium)"; fi
export HOST=127.0.0.1
export PORT=8787
exec node src/server.js
