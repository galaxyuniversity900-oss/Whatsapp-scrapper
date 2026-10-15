'use strict';

const crypto = require('node:crypto');

function clean(value) { return String(value == null ? '' : value).trim(); }
function phoneKey(value) { return clean(value).replace(/\D/g, ''); }
function stableId(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

/**
 * Builds a transparent, deterministic campaign plan without sending messages or
 * changing contact records. Eligibility requires explicit consent and no opt-out.
 */
class SmartCampaignPlanner {
  plan({ campaignId = null, contacts = [], message = '', batchSize = 50, maxRecipients = 500, dryRun = true } = {}) {
    if (!Array.isArray(contacts)) throw new TypeError('contacts must be an array');
    const body = clean(message);
    const size = Math.max(1, Math.min(500, Math.floor(Number(batchSize) || 50)));
    const cap = Math.max(0, Math.min(100000, Math.floor(Number(maxRecipients) || 0)));
    const seen = new Set();
    const eligible = [];
    const excluded = [];
    for (let index = 0; index < contacts.length; index++) {
      const c = contacts[index] && typeof contacts[index] === 'object' ? contacts[index] : {};
      const phone = phoneKey(c.phone || c.number);
      const reasons = [];
      if (!phone || phone.length < 7 || phone.length > 15) reasons.push('invalid_phone');
      if (c.consent !== true) reasons.push('consent_not_confirmed');
      if (c.optOut === true || c.optedOut === true || c.status === 'suppressed' || c.status === 'opted_out') reasons.push('opted_out');
      if (phone && seen.has(phone)) reasons.push('duplicate_phone');
      if (phone) seen.add(phone);
      if (!body) reasons.push('empty_message');
      const row = { sourceIndex: index, contactId: clean(c.id) || null, phoneMasked: phone ? phone.replace(/.(?=.{4})/g, '*') : null };
      if (reasons.length) excluded.push({ ...row, reasons });
      else eligible.push({ ...row, _phone: phone });
    }
    const selected = eligible.slice(0, cap);
    const capped = eligible.slice(cap).map(({ _phone, ...row }) => ({ ...row, reasons: ['campaign_cap_exceeded'] }));
    const batches = [];
    for (let i = 0; i < selected.length; i += size) {
      batches.push({ batch: batches.length + 1, recipients: selected.slice(i, i + size).map(({ _phone, ...row }) => row) });
    }
    const messageHash = crypto.createHash('sha256').update(body).digest('hex');
    const planCore = { campaignId: campaignId == null ? null : String(campaignId), messageHash, sourceCount: contacts.length, batchSize: size, maxRecipients: cap, selected: selected.map(x => x.contactId || x.phoneMasked) };
    return {
      version: 1, planId: 'plan_' + stableId(planCore), createdAt: new Date().toISOString(),
      campaignId: planCore.campaignId, dryRun: dryRun !== false, verdict: !body ? 'blocked' : selected.length ? 'ready_for_operator_review' : 'blocked',
      summary: { input: contacts.length, eligibleBeforeCap: eligible.length, selected: selected.length, excluded: excluded.length, capped: capped.length, batches: batches.length, batchSize: size },
      blockers: !body ? ['message_empty'] : selected.length ? [] : ['no_eligible_recipients'],
      messageHash, batches, excluded: excluded.concat(capped),
      guarantees: { sentMessages: 0, contactsModified: false, consentRequired: true, optOutAlwaysExcluded: true, phoneNumbersMasked: true }
    };
  }
}
module.exports = { SmartCampaignPlanner };
