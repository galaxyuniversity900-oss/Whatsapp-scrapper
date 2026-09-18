#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "== Termux smoke test =="
command -v node >/dev/null || { echo "Node.js is required"; exit 1; }
node --version
node --check src/1-state-persistence-fix.js
node --check src/2-parallel-processing-fix.js
node --check src/3-browser-selection-fix.js
node --check src/4-integration-campaign.js
node --check src/5-contact-policy.js
node --check src/6-audit-log.js
node --check src/7-scheduler.js
node --check src/8-delivery-tracker.js
node --check src/9-account-registry.js
node test/5-tests.js
node test/6-hardening-tests.js
node test/7-professional-tests.js
echo "== Termux core test completed =="