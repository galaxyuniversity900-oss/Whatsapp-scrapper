#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js/npm not found. In Termux run: pkg install nodejs-lts npm"
  exit 1
fi

if [ ! -d node_modules/whatsapp-web.js ]; then
  echo "Installing runtime dependencies only (Electron/dev dependencies are skipped)..."
  npm install --omit=dev
fi

CHROMIUM_BIN="${CHROME_BIN:-}"
if [ -z "$CHROMIUM_BIN" ]; then
  CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || true)"
fi
if [ -z "$CHROMIUM_BIN" ] || [ ! -x "$CHROMIUM_BIN" ]; then
  echo "ERROR: Chromium executable not found."
  echo "Install/check Chromium in Termux, then set CHROME_BIN to its executable path."
  exit 1
fi

export CHROME_BIN="$CHROMIUM_BIN"
export WA_DEFAULT_HEADLESS="${WA_DEFAULT_HEADLESS:-1}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8787}"

echo "Starting WhatsApp Scrapper backend"
echo "Host: $HOST"
echo "Port: $PORT"
echo "Chromium: $CHROME_BIN"
echo "Headless by default: $WA_DEFAULT_HEADLESS"
echo "Keep Termux running while the Android app is connected."
exec node src/server.js
