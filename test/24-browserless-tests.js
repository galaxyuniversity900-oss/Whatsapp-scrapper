'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SecretStore } = require('../src/18-secret-store');
const { BrowserlessSessionManager, normalizeBaseUrl, validateSessionUrl } = require('../src/35-browserless-session');

function store() {
  const rows = new Map();
  return {
    set(key, value) { rows.set(key, value); return true; },
    get(key) { return rows.get(key) || null; },
    remove(key) { return rows.delete(key); },
    rows
  };
}

async function run() {
  assert.strictEqual(normalizeBaseUrl('https://chrome.example.browserless.io/'), 'https://chrome.example.browserless.io');
  assert.throws(() => normalizeBaseUrl('http://not-secure.example'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.com'), /HTTPS/);
  assert.strictEqual(validateSessionUrl('wss://private.browserless.example/session/1', 'wss:', 'https://private.browserless.example').hostname, 'private.browserless.example');
  assert.throws(() => validateSessionUrl('https://attacker.example/steal', 'https:', 'https://private.browserless.example'), /configured host/);
  assert.throws(() => validateSessionUrl('wss://user:pass@private.browserless.example/session', 'wss:', 'https://private.browserless.example'), /configured host/);
  assert.throws(() => validateSessionUrl('wss://private.browserless.example:444/session', 'wss:', 'https://private.browserless.example'), /configured host/);
  assert.throws(() => validateSessionUrl('wss://private.browserless.example/session#fragment', 'wss:', 'https://private.browserless.example'), /configured host/);
  assert.throws(() => validateSessionUrl('https://private.browserless.example/session', 'wss:', 'https://private.browserless.example'), /configured host/);

  const secrets = store();
  let now = 1000000;
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    if (options.method === 'DELETE') return { ok: true, status: 200 };
    assert.match(url, /^https:\/\/private\.browserless\.example\/session\?token=/);
    assert.strictEqual(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.ttl, 86400000);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'remote-1',
        connect: 'wss://private.browserless.example/session/remote-1?token=embedded',
        stop: 'https://private.browserless.example/session/remote-1?token=embedded',
        ttl: 86400000
      })
    };
  };
  const manager = new BrowserlessSessionManager({
    secretStore: secrets,
    env: {
      BROWSERLESS_BASE_URL: 'https://private.browserless.example',
      BROWSERLESS_TOKEN: 'test-token-only',
      BROWSERLESS_SESSION_TTL_MS: '86400000',
      BROWSERLESS_PROCESS_KEEPALIVE_MS: '60000'
    },
    fetchImpl,
    now: () => now
  });

  const first = await manager.getOrCreate('account-1');
  assert.strictEqual(first.reused, false);
  assert.strictEqual(first.connect.startsWith('wss://'), true);
  assert.strictEqual(secrets.rows.has('browserless-session-account-1'), true);
  const second = await manager.getOrCreate('account-1');
  assert.strictEqual(second.reused, true);
  assert.strictEqual(calls, 1, 'valid session should be reused without another API call');

  now += 86400000;
  const third = await manager.getOrCreate('account-1');
  assert.strictEqual(third.reused, false);
  assert.strictEqual(calls, 3, 'expired session should be deleted and replaced');

  let deleteCalled = false;
  const deleteManager = new BrowserlessSessionManager({
    secretStore: secrets,
    env: { BROWSERLESS_BASE_URL: 'https://private.browserless.example', BROWSERLESS_TOKEN: 'test-token-only' },
    fetchImpl: async (url, options) => {
      if (options.method === 'DELETE') {
        deleteCalled = true;
        assert.match(url, /force=true/);
        return { ok: true, status: 200 };
      }
      throw new Error('Unexpected request');
    },
    now: () => now
  });
  const forgotten = await deleteManager.forget('account-1');
  assert.strictEqual(forgotten.remoteDeleted, true);
  assert.strictEqual(deleteCalled, true);
  assert.strictEqual(secrets.rows.has('browserless-session-account-1'), false);

  const poisoned = store();
  poisoned.set('browserless-session-poisoned', JSON.stringify({ stop: 'https://attacker.example/delete?token=secret' }));
  let attackerCalled = false;
  const poisonManager = new BrowserlessSessionManager({
    secretStore: poisoned,
    env: {
      BROWSERLESS_BASE_URL: 'https://private.browserless.example',
      BROWSERLESS_TOKEN: 'test-token-only'
    },
    fetchImpl: async url => {
      if (String(url).includes('attacker.example')) attackerCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          connect: 'wss://private.browserless.example/session/ok',
          stop: 'https://private.browserless.example/session/ok'
        })
      };
    }
  });
  await poisonManager.getOrCreate('poisoned');
  assert.strictEqual(attackerCalled, false, 'untrusted saved stop URL must never be fetched');

  const poisonedForget = store();
  poisonedForget.set('browserless-session-poisoned-forget', JSON.stringify({
    stop: 'https://attacker.example/delete?token=secret'
  }));
  let poisonedForgetCalls = 0;
  const poisonedForgetManager = new BrowserlessSessionManager({
    secretStore: poisonedForget,
    env: {
      BROWSERLESS_BASE_URL: 'https://private.browserless.example',
      BROWSERLESS_TOKEN: 'test-token-only'
    },
    fetchImpl: async () => {
      poisonedForgetCalls++;
      throw new Error('Untrusted URL must not be requested');
    }
  });
  const poisonedForgetResult = await poisonedForgetManager.forget('poisoned-forget');
  assert.strictEqual(poisonedForgetCalls, 0, 'forget must not request an untrusted saved stop URL');
  assert.strictEqual(poisonedForgetResult.remoteDeleted, false);
  assert.strictEqual(poisonedForget.rows.has('browserless-session-poisoned-forget'), false,
    'forget must remove poisoned local metadata without making an outbound request');

  const unconfigured = new BrowserlessSessionManager({ secretStore: secrets, env: {}, fetchImpl });
  await assert.rejects(() => unconfigured.getOrCreate('x'), /BROWSERLESS_TOKEN/);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-secret-store-test-'));
  try {
    const secretsFile = path.join(tempDir, 'secrets.json');
    const keyFile = path.join(tempDir, 'secret-store.key');
    const firstStore = new SecretStore(secretsFile, { keyFile });
    assert.strictEqual(firstStore.set('restart-check', 'encrypted-session-metadata'), true);
    const secondStore = new SecretStore(secretsFile, { keyFile });
    assert.strictEqual(
      secondStore.get('restart-check'),
      'encrypted-session-metadata',
      'encrypted secrets must remain readable after constructing a new store instance'
    );
    assert.ok(fs.readFileSync(keyFile, 'utf8').endsWith('\n'), 'key file must end with a real newline');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-secret-store-legacy-'));
  try {
    const legacyFile = path.join(legacyDir, 'secrets.json');
    const legacyKeyFile = path.join(legacyDir, 'secret-store.key');
    const legacyKey = 'legacy-browserless-test-key';
    fs.writeFileSync(legacyKeyFile, legacyKey + '\\\\n', { mode: 0o600 });
    const legacyStore = new SecretStore(legacyFile, { keyFile: legacyKeyFile });
    assert.strictEqual(legacyStore.set('legacy-session', 'legacy-session-value'), true);
    const restartedLegacyStore = new SecretStore(legacyFile, { keyFile: legacyKeyFile });
    assert.strictEqual(restartedLegacyStore.get('legacy-session'), 'legacy-session-value',
      'legacy key files must be recoverable after restart');
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }

  console.log('Browserless session tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
