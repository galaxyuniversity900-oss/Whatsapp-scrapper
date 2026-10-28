'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SecretStore } = require('../src/18-secret-store');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-secret-store-'));
try {
  const file = path.join(tempDir, 'secrets.json');
  const keyFile = path.join(tempDir, 'secret-store.key');

  const first = new SecretStore(file, { keyFile });
  assert.strictEqual(first.set('session', 'persisted-secret-value'), true);
  assert.ok(fs.readFileSync(keyFile, 'utf8').endsWith('\n'), 'new key files must end with a real newline');

  const restarted = new SecretStore(file, { keyFile });
  assert.strictEqual(restarted.get('session'), 'persisted-secret-value', 'encrypted values must survive process restart');

  const legacyFile = path.join(tempDir, 'legacy-secrets.json');
  const legacyKeyFile = path.join(tempDir, 'legacy-secret-store.key');
  const legacyKey = 'legacy-key-for-regression-test';
  fs.writeFileSync(legacyKeyFile, legacyKey + '\\n', { mode: 0o600 });
  const legacyWriter = new SecretStore(legacyFile, { keyFile: legacyKeyFile });
  assert.strictEqual(legacyWriter.set('legacy-session', 'recoverable-session-value'), true);
  const legacyRestart = new SecretStore(legacyFile, { keyFile: legacyKeyFile });
  assert.strictEqual(legacyRestart.get('legacy-session'), 'recoverable-session-value',
    'legacy key files with a literal escaped newline must remain decryptable');
  console.log('SecretStore persistence and legacy-key tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
