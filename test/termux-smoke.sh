#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "== Termux smoke test =="
command -v node >/dev/null || { echo "Node.js is required"; exit 1; }
node --version
node --check src/1-state-persistence-fix.js
node --check src/2-parallel-processing-fix.js
node --check src/3-browser-selection-fix.js
node --check src/4-integration-campaign.js
node test/5-tests.js
echo "== Termux core test completed =="