'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts/termux-service.sh'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/TERMUX-PERSISTENT-SERVICE.md'), 'utf8');
for (const command of ['start', 'status', 'stop', 'restart', 'logs']) {
  assert.ok(script.includes(command), 'service command missing: ' + command);
}
assert.ok(script.includes('node src/server.js'), 'must run existing server');
assert.ok(script.includes('sleep 5'), 'must use bounded restart delay');
assert.ok(script.includes('server.log'), 'must persist logs');
assert.ok(script.includes('127.0.0.1'), 'must document safe localhost binding');
assert.ok(!script.includes('npm install'), 'must not install packages');
assert.ok(docs.includes('Android limitations'), 'must explain Android background limits');
console.log('PASS Termux persistent service static checks');
