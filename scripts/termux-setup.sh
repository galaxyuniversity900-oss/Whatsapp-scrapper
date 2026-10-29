#!/data/data/com.termux/files/usr/bin/bash
# Prepare the existing project for local Termux operation; no Browserless/cloud browser is used.
set -euo pipefail

if [ -n "${WA_PROJECT_DIR:-}" ]; then
  PROJECT_DIR="$WA_PROJECT_DIR"
elif [ -f "$HOME/Whatsapp-scrapper/src/server.js" ]; then
  PROJECT_DIR="$HOME/Whatsapp-scrapper"
elif [ -f "$HOME/Whatsapp-scrapper-source/Whatsapp-scrapper-main/src/server.js" ]; then
  PROJECT_DIR="$HOME/Whatsapp-scrapper-source/Whatsapp-scrapper-main"
else
  PROJECT_DIR="$HOME/Whatsapp-scrapper"
fi
DATA_DIR="${WA_DATA_DIR:-$HOME/.whatsapp-scrapper}"

if ! command -v pkg >/dev/null 2>&1; then
  echo "Run this script inside the Termux app on Android."
  exit 2
fi

echo "Requesting Android shared-storage permission (approve the Android prompt if shown)..."
termux-setup-storage || true

pkg update -y
pkg install -y nodejs-lts git curl

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "Project not found at $PROJECT_DIR"
  echo "Clone it first: git clone https://github.com/galaxyuniversity900-oss/Whatsapp-scrapper.git ~/Whatsapp-scrapper"
  echo "Or set WA_PROJECT_DIR to the existing project folder."
  exit 2
fi

cd "$PROJECT_DIR"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
echo "Installing runtime dependencies only (Electron desktop binaries are excluded)..."
npm install --omit=dev --ignore-scripts

echo
echo "=== Termux preflight ==="
node --version
npm --version
if command -v chromium >/dev/null 2>&1; then
  echo "Chromium executable: $(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  echo "Chromium executable: $(command -v chromium-browser)"
else
  echo "WARNING: Chromium was not found on PATH."
  echo "WhatsApp Web QR login needs a Chromium binary compatible with this Termux/Android environment."
fi
echo "Persistent app data: $DATA_DIR"
echo "Project: $PROJECT_DIR"
echo "Next: bash scripts/termux-service.sh start"
