'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TelegramAdapter, normalizeEntity } = require('../src/28-telegram-adapter');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-telegram-test-'));
const adapter = new TelegramAdapter({ dataDir: tmp });

assert.equal(adapter.capabilities().provider, 'telegram');
assert.equal(adapter.capabilities().publicSearch, true);
assert.equal(adapter.capabilities().privacyBypass, false);
assert.equal(adapter.capabilities().privateDataBypass, false);

const entity = normalizeEntity({
  id: 123,
  username: 'public_channel',
  title: 'Public Channel',
  verified: true,
  participantsCount: 42
});
assert.deepEqual(entity.id, '123');
assert.equal(entity.username, 'public_channel');
assert.equal(entity.title, 'Public Channel');
assert.equal(entity.verified, true);
assert.equal(entity.participantsCount, 42);

assert.deepEqual(adapter.listAccounts(), []);
console.log('Telegram adapter tests passed');
