#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

REPO_URL="https://github.com/galaxyuniversity900-oss/Whatsapp-scrapper.git"
EXPECTED_BRANCH="browserless-remote-browser"
DASHBOARD_URL="https://dashboard.render.com/blueprints"

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n[setup] %s\n' "$*"; }

command -v git >/dev/null 2>&1 || fail "Install Git first: pkg install git"
command -v node >/dev/null 2>&1 || fail "Install Node.js first: pkg install nodejs-lts"
command -v npm >/dev/null 2>&1 || fail "npm is missing; reinstall nodejs-lts"
command -v curl >/dev/null 2>&1 || fail "Install curl first: pkg install curl"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from the cloned Whatsapp-scrapper repository."
cd "$ROOT"
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "$EXPECTED_BRANCH" ] || fail "Expected branch '$EXPECTED_BRANCH'; current branch is '$BRANCH'. Clone it with: git clone -b $EXPECTED_BRANCH $REPO_URL"

info "Checking deployment configuration and code before opening Render."
test -s Dockerfile || fail "Dockerfile is missing."
test -s render.yaml || fail "render.yaml is missing."
test -s src/server.js || fail "src/server.js is missing."
test -s src/35-browserless-session.js || fail "Browserless session module is missing."
grep -q 'BROWSERLESS_BASE_URL' render.yaml || fail "Render blueprint lacks Browserless endpoint configuration."
grep -q 'BROWSERLESS_TOKEN' render.yaml || fail "Render blueprint lacks Browserless token configuration."
grep -q 'mountPath: /var/data' render.yaml || fail "Render persistent disk is not configured."

info "Installing only the Node project dependencies needed for validation."
npm install --ignore-scripts --no-audit --no-fund
info "Running JavaScript syntax checks."
npm run lint
info "Running Browserless session lifecycle tests."
npm run test:browserless
info "Checking Android/backend integration contract."
bash android/scripts/verify-integration.sh
info "Checking deployment script syntax."
bash -n android/termux-deploy-render.sh

printf '\nPRE-DEPLOY CHECKS PASSED. No cloud service has been created yet.\n'
printf '\nNext steps in Render (account authorization is required):\n'
printf '  1. Create a new Blueprint and connect this repository.\n'
printf '  2. Select branch: %s\n' "$EXPECTED_BRANCH"
printf '  3. Review the Starter plan and persistent disk cost before deploying.\n'
printf '  4. Supply BROWSERLESS_BASE_URL and BROWSERLESS_TOKEN in Render only.\n'
printf '     Use the exact Private Fleet endpoint from your Browserless dashboard.\n'
printf '  5. Deploy the Blueprint and wait until the service is Live.\n'

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$DASHBOARD_URL" || true
else
  printf '\nOpen this page in your browser: %s\n' "$DASHBOARD_URL"
fi

printf '\nAfter deployment, return here and paste the HTTPS service URL to verify /healthz.\n'
read -r -p 'Render service URL (or press Enter to verify later): ' SERVICE_URL
[ -n "$SERVICE_URL" ] || { printf 'Deferred. Re-run this script after deployment to complete local verification.\n'; exit 0; }

SERVICE_URL="${SERVICE_URL%/}"
case "$SERVICE_URL" in https://*) ;; *) fail "Remote service URL must start with https://";; esac
case "$SERVICE_URL" in *'@'*|*' '*|*'?'*|*'#'*) fail "Enter only the base HTTPS service URL, without credentials, query, or fragment.";; esac

info "Checking the deployed public health endpoint."
HEALTH=""
for attempt in $(seq 1 18); do
  HEALTH="$(curl -fsS --connect-timeout 10 --max-time 20 "$SERVICE_URL/healthz" 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"healthy"'; then break; fi
  sleep 10
done
printf '%s' "$HEALTH" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"healthy"' || fail "The service did not return a healthy response after retries. Check Render Deploys and Logs; do not assume deployment succeeded."

CONFIG_DIR="$HOME/.config/whatsapp-scrapper"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
printf '%s\n' "$SERVICE_URL" > "$CONFIG_DIR/server-url"
chmod 600 "$CONFIG_DIR/server-url"

printf '\nPASS: Render /healthz returned healthy.\n'
printf 'Server URL saved locally at: %s/server-url\n' "$CONFIG_DIR"
printf '\nIn the APK, enter this URL once in the top address field; the app remembers it:\n%s/\n' "$SERVICE_URL"
printf 'The first protected page load should prompt for WA_ADMIN_USER and WA_ADMIN_PASSWORD from Render.\n'
printf 'This test confirms only HTTP health, not Browserless login, WhatsApp QR pairing, session restoration, or message delivery.\n'
