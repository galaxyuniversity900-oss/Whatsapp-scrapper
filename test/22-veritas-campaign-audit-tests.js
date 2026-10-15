'use strict';
const assert = require('node:assert/strict');
const { VeritasCampaignAudit } = require('../src/34-veritas-campaign-audit');

const events = [];
const engine = new VeritasCampaignAudit({ audit: { append: (event, data) => events.push({ event, data }) } });
const result = engine.preflight({
  campaignId: 'spring',
  message: 'Hello {name}',
  contacts: [
    { id: 'a', phone: '+201001234567', name: 'A', consent: true },
    { id: 'b', phone: '201001234567', consent: true },
    { id: 'c', phone: '201009876543', consent: false },
    { id: 'd', phone: '201001112222', consent: true, optOut: true },
    { id: 'e', phone: '', consent: true }
  ]
});
assert.equal(result.counts.input, 5);
assert.equal(result.counts.eligible, 1);
assert.equal(result.counts.blocked, 4);
assert.equal(result.counts.duplicate, 1);
assert.equal(result.verdict, 'review_required');
assert.deepEqual(result.unresolvedVariables, ['{name}']);
assert.equal(result.evidencePolicy.sendingPerformed, false);
assert.equal(events.length, 1);

const empty = engine.preflight({ contacts: [{ phone: '201001234567', consent: true }], message: ' ' });
assert.equal(empty.verdict, 'blocked');
assert.ok(empty.blockers.includes('message_empty'));
assert.equal(empty.recipients[0].eligible, false);

const summary = engine.auditSummary({
  contacts: [{ consent: true }, { consent: false }, {}],
  delivery: [{ status: 'failed' }, { status: 'sent' }, {}],
  auditEvents: [{ timestamp: 'bad' }, { timestamp: '2026-01-01T00:00:00Z' }]
});
assert.equal(summary.contacts.consentNotConfirmed, 2);
assert.equal(summary.delivery.byStatus.failed, 1);
assert.equal(summary.delivery.byStatus.unknown, 1);
assert.equal(summary.audit.malformedTimestamps, 1);
assert.equal(summary.delivery.total, 3);
console.log('VERITAS campaign integrity tests passed.');
