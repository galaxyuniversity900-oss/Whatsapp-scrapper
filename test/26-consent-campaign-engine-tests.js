'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'index.html'), 'utf8');
const { ConsentCampaignEngine } = require('../src/35-consent-campaign-engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-campaign-'));
const events = [];
const engine = new ConsentCampaignEngine(dir, { audit: { append: (event, data) => events.push({ event, data }) } });
assert.throws(() => engine.recordConsent({ phone: '+201001234567', consent: true }), /purpose, source, and evidenceRef/);
engine.recordConsent({ phone: '+201001234567', consent: true, purpose: 'offers', source: 'website-form', evidenceRef: 'form-record-42' });
let check = engine.preflight({
  campaignId: 'spring', message: 'Hello {name}', contacts: [
    { id: 'one', phone: '201001234567', purpose: 'offers' },
    { id: 'two', phone: '201001234567', purpose: 'offers' },
    { id: 'three', phone: '201009876543', consent: false }
  ]
});
assert.equal(check.counts.eligible, 1);
assert.equal(check.counts.duplicate, 1);
assert.equal(check.counts.noConsent, 1);
assert.equal(check.verdict, 'review_required');
assert.equal(check.sendingPerformed, false);
engine.suppress('201001234567', 'requested by recipient');
check = engine.preflight({ message: 'Hello', contacts: [{ phone: '201001234567', purpose: 'offers' }] });
assert.equal(check.counts.eligible, 0);
assert.ok(check.recipients[0].reasons.includes('suppressed_or_opted_out'));
assert.throws(() => engine.unsuppress('201001234567', 'yes'), /Explicit confirmation/);
assert.equal(engine.unsuppress('201001234567', 'CONFIRM RECONSENT').ok, true);
check = engine.preflight({ message: 'Hello', contacts: [{ phone: '201001234567', purpose: 'offers' }] });
assert.equal(check.counts.eligible, 1);
const draft = engine.createDraft({ title: 'Spring offers', message: 'Hello {name}', purpose: 'offers', channel: 'telegram' });
assert.equal(draft.status, 'draft');
assert.equal(draft.sendingEnabled, false);
assert.equal(engine.listDrafts()[0].id, draft.id);
assert.ok(events.length >= 5);
fs.rmSync(dir, { recursive: true, force: true });
assert.ok(ui.includes('data-view="experimental"'), 'experimental consent workspace navigation must exist');
assert.ok(ui.includes('id="expConsentEvidence"'), 'consent evidence form must exist');
assert.ok(ui.includes('function expPreflight()'), 'audience preflight UI must exist');
assert.ok(ui.includes('function expSuppress()'), 'suppression UI must exist');
assert.ok(ui.includes('function expCreateDraft()'), 'campaign draft UI must exist');
console.log('Consent campaign engine tests passed.');
