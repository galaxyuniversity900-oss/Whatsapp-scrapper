'use strict';
const assert = require('node:assert/strict');
const { SmartCampaignPlanner } = require('../src/35-smart-campaign-planner');
const planner = new SmartCampaignPlanner();
const contacts = [
 { id:'a', phone:'+201001234567', consent:true },
 { id:'b', phone:'201001234567', consent:true },
 { id:'c', phone:'201009876543', consent:false },
 { id:'d', phone:'201009876544', consent:true, optOut:true },
 { id:'e', phone:'201009876545', consent:true },
 { id:'f', phone:'123', consent:true }
];
const plan = planner.plan({ campaignId:'qa', contacts, message:'Hello {name}', batchSize:1, maxRecipients:1 });
assert.equal(plan.summary.input, 6);
assert.equal(plan.summary.eligibleBeforeCap, 2);
assert.equal(plan.summary.selected, 1);
assert.equal(plan.summary.capped, 1);
assert.equal(plan.summary.batches, 1);
assert.equal(plan.guarantees.sentMessages, 0);
assert.equal(plan.guarantees.contactsModified, false);
assert.equal(plan.batches[0].recipients[0].phoneMasked, '********4567');
assert.ok(plan.excluded.some(x => x.reasons.includes('consent_not_confirmed')));
assert.ok(plan.excluded.some(x => x.reasons.includes('opted_out')));
assert.ok(plan.excluded.some(x => x.reasons.includes('duplicate_phone')));
assert.ok(plan.excluded.some(x => x.reasons.includes('invalid_phone')));
assert.equal(plan.verdict, 'ready_for_operator_review');
const empty = planner.plan({ contacts:[{phone:'201001234567',consent:true}], message:' ' });
assert.equal(empty.verdict, 'blocked');
assert.ok(empty.blockers.includes('message_empty'));
const noConsent = planner.plan({ contacts:[{phone:'201001234567'}], message:'hello' });
assert.equal(noConsent.verdict, 'blocked');
assert.equal(noConsent.summary.selected, 0);
assert.throws(() => planner.plan({ contacts:{}, message:'x' }), /contacts must be an array/);
console.log('Smart campaign planner tests passed.');
