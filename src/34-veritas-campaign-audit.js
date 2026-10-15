'use strict';

const crypto = require('crypto');

function text(value) { return String(value == null ? '' : value).trim(); }
function phoneKey(value) { return text(value).replace(/\D/g, ''); }
function stableId(prefix, input) {
  return prefix + '_' + crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

/**
 * Evidence-first campaign preflight.
 * It never sends messages and never changes consent state. It reports only
 * fields present in the supplied records; missing evidence is not treated as consent.
 */
class VeritasCampaignAudit {
  constructor({ audit = null } = {}) { this.audit = audit; }

  preflight({ contacts = [], message = '', campaignId = null } = {}) {
    if (!Array.isArray(contacts)) throw new TypeError('contacts must be an array');
    const body = text(message);
    const seen = new Set();
    const rows = [];
    const counts = {
      input: contacts.length, eligible: 0, blocked: 0, duplicate: 0,
      missingPhone: 0, noConsentEvidence: 0, optedOut: 0, invalidPhone: 0
    };

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i] && typeof contacts[i] === 'object' ? contacts[i] : {};
      const phone = phoneKey(c.phone || c.number || c.id);
      const reasons = [];
      if (!phone) { reasons.push('missing_phone'); counts.missingPhone++; }
      else if (phone.length < 7 || phone.length > 15) { reasons.push('invalid_phone'); counts.invalidPhone++; }
      if (!phone || phone.length < 7 || phone.length > 15) { /* already recorded */ }
      if (c.optOut === true || c.optedOut === true || c.status === 'suppressed' || c.status === 'opted_out') {
        reasons.push('opted_out'); counts.optedOut++;
      }
      if (c.consent !== true) { reasons.push('consent_not_confirmed'); counts.noConsentEvidence++; }
      if (phone && seen.has(phone)) { reasons.push('duplicate_phone'); counts.duplicate++; }
      if (phone) seen.add(phone);
      if (!body) reasons.push('empty_message');

      const eligible = reasons.length === 0;
      if (eligible) counts.eligible++; else counts.blocked++;
      rows.push({
        index: i, contactId: text(c.id) || null,
        phoneMasked: phone ? phone.replace(/.(?=.{4})/g, '*') : null,
        eligible, reasons
      });
    }

    const unresolvedVariables = [...new Set((body.match(/\{[^{}]{1,80}\}/g) || []))];
    const warnings = [];
    if (body.length > 4000) warnings.push({ code: 'LONG_MESSAGE', severity: 'warning', detail: 'Message exceeds 4000 characters; verify channel limits and readability.' });
    if (unresolvedVariables.length) warnings.push({ code: 'UNRESOLVED_TEMPLATE_VARIABLES', severity: 'warning', variables: unresolvedVariables });
    if (!body) warnings.push({ code: 'EMPTY_MESSAGE', severity: 'blocker' });
    if (!contacts.length) warnings.push({ code: 'EMPTY_AUDIENCE', severity: 'blocker' });

    const blockers = [];
    if (!body) blockers.push('message_empty');
    if (counts.eligible === 0 && contacts.length) blockers.push('no_eligible_recipients');
    const result = {
      version: 1, auditId: stableId('preflight', { campaignId, contacts: contacts.length, bodyHash: crypto.createHash('sha256').update(body).digest('hex') }),
      createdAt: new Date().toISOString(), campaignId: campaignId == null ? null : String(campaignId),
      verdict: blockers.length ? 'blocked' : warnings.length ? 'review_required' : 'ready_for_operator_review',
      counts, blockers, warnings, unresolvedVariables,
      recipients: rows,
      evidencePolicy: {
        consentRule: 'Only consent === true is accepted; missing/unknown consent is blocked.',
        optOutRule: 'Explicit opt-out/suppression is blocked even if consent is true.',
        sendingPerformed: false,
        dataChanged: false
      }
    };
    try { this.audit?.append('veritas_campaign_preflight', { auditId: result.auditId, campaignId: result.campaignId, verdict: result.verdict, counts }); } catch {}
    return result;
  }

  auditSummary({ contacts = [], delivery = [], auditEvents = [] } = {}) {
    const statusCounts = {};
    for (const row of Array.isArray(delivery) ? delivery : []) {
      const key = text(row && row.status) || 'unknown';
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    }
    const events = Array.isArray(auditEvents) ? auditEvents : [];
    const consentUnknown = (Array.isArray(contacts) ? contacts : []).filter(c => !c || c.consent !== true).length;
    const malformedEvents = events.filter(e => !e || !e.timestamp || Number.isNaN(new Date(e.timestamp).getTime())).length;
    return {
      version: 1, generatedAt: new Date().toISOString(),
      contacts: { total: Array.isArray(contacts) ? contacts.length : 0, consentNotConfirmed: consentUnknown },
      delivery: { total: Array.isArray(delivery) ? delivery.length : 0, byStatus: statusCounts },
      audit: { total: events.length, malformedTimestamps: malformedEvents },
      limitations: [
        'This report summarizes supplied local records; it does not independently verify WhatsApp delivery.',
        'Consent is inferred only from the explicit consent field and does not prove how consent was collected.'
      ]
    };
  }
}

module.exports = { VeritasCampaignAudit, phoneKey };
