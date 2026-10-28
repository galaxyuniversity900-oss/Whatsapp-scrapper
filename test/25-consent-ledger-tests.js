'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConsentLedger } = require('../src/36-consent-ledger');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-consent-'));
const file = path.join(dir, 'consent.json');
try {
  let ledger = new ConsentLedger(file);
  assert.equal(ledger.status('+201001234567').status, 'unknown');
  const grant = ledger.record({phone:'+201001234567',decision:'granted',purpose:'service updates',evidenceRef:'form-12'});
  assert.equal(grant.decision, 'granted');
  assert.equal(grant.phoneMasked, '********4567');
  assert.equal(ledger.status('201001234567').eligibleByLedger, true);
  ledger.record({phone:'201001234567',decision:'opted_out',purpose:'recipient request'});
  assert.equal(ledger.status('201001234567').status, 'opted_out');
  assert.equal(ledger.status('201001234567').eligibleByLedger, false);
  ledger = new ConsentLedger(file);
  assert.equal(ledger.status('201001234567').history.length, 2);
  assert.throws(() => ledger.record({phone:'123',decision:'granted',purpose:'x'}), /valid phone/);
  assert.throws(() => ledger.record({phone:'201001234567',decision:'maybe',purpose:'x'}), /decision must/);
  assert.throws(() => ledger.record({phone:'201001234567',decision:'granted'}), /purpose is required/);
  assert.equal(ledger.summary().eventCount, 2);
  console.log('Consent ledger tests passed.');
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
