'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UniversalConnectorHub, AGENT_CATALOG } = require('../src/35-universal-connector-hub');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-connectors-'));
  const hub = new UniversalConnectorHub({ dataDir: dir, masterKey: 'unit-test-master-key', timeoutMs: 1500 });
  assert.ok(AGENT_CATALOG.some(x => x.id === 'nvidia-nim'), 'NVIDIA NIM preset exists');
  assert.ok(AGENT_CATALOG.some(x => x.id === 'mcp-http'), 'MCP preset exists');
  const row = hub.upsert({ id:'cookie-test', name:'Cookie Test', type:'cookie', endpoint:'http://127.0.0.1:1/session', credentialMode:'cookie', credentials:{cookie:'sid=secret-session-value'} });
  assert.equal(row.hasCredentials, true);
  assert.equal(JSON.stringify(row).includes('secret-session-value'), false);
  const onDisk = fs.readFileSync(path.join(dir, 'connectors.json'), 'utf8');
  assert.equal(onDisk.includes('secret-session-value'), false, 'cookie/session credentials must be encrypted at rest');
  assert.equal(hub.credentials('cookie-test').cookie, 'sid=secret-session-value');
  assert.throws(() => hub.upsert({ id:'bad', type:'api', endpoint:'file:///etc/passwd' }), /HTTP or HTTPS/);
  assert.throws(() => hub.upsert({ id:'bad-url', type:'api', endpoint:'https://user:pass@example.com' }), /credentials/);
  assert.throws(() => hub.upsert({ id:'bad-type', type:'other', endpoint:'https://example.com' }), /Unsupported connector type/);
  const removed = hub.remove('cookie-test');
  assert.equal(removed.removed, true);
  assert.equal(hub.list().length, 0);
  console.log('Universal connector hub tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
