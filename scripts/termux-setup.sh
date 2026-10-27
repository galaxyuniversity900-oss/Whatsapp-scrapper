#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if [ -z "${TERMUX_VERSION:-}" ]; then
  echo "Run this script inside Termux on Android."
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "Node.js missing. Run: pkg install nodejs-lts"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is missing with Node.js."; exit 1; }
command -v chromium >/dev/null 2>&1 || { echo "Chromium missing. Run: pkg install chromium"; exit 1; }
export PUPPETEER_SKIP_DOWNLOAD=1
export CHROME_BIN="$(command -v chromium)"
npm install --omit=dev
echo "Termux dependencies installed. Start with: bash scripts/termux-start.sh"
