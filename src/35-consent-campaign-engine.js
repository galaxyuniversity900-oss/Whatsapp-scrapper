'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function normalizePhone(value) { return String(value == null ? '' : value).replace(/\\D/g, ''); }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readRows(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function id(prefix, value) {
  return prefix + '_' + crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 18);
}

class ConsentCampaignEngine {
  constructor(dataDir, { audit = null } = {}) {
    this.dir = path.resolve(dataDir);
    fs.mkdirSync(this.dir, { recursive: true });
    this.consentFile = path.join(this.dir, 'consent-ledger.json');
    this.suppressionFile = path.join(this.dir, 'suppression-list.json');
    this.draftsFile = path.join(this.dir, 'campaign-drafts.json');
    this.audit = audit;
  }
  _consents() { return readRows(this.consentFile); }
  _suppressions() { return readRows(this.suppressionFile); }
  _drafts() { return readRows(this.draftsFile); }
  _audit(event, data) { try { this.audit?.append(event, data); } catch {} }

  recordConsent(input = {}) {
    const phone = normalizePhone(input.phone);
    if (!/^\\d{7,15}$/.test(phone)) throw new Error('A valid international phone number is required.');
    if (input.consent !== true && input.consent !== false) throw new Error('consent must be true or false.');
    const purpose = clean(input.purpose, 160);
    const source = clean(input.source, 160);
    const evidenceRef = clean(input.evidenceRef, 500);
    if (input.consent === true && (!purpose || !source || !evidenceRef)) {
      throw new Error('Consent requires purpose, source, and evidenceRef; missing evidence is not consent.');
    }
    const row = {
      id: id('consent', { phone, purpose, source, evidenceRef, consent: input.consent, at: input.at || '' }),
      phone, consent: input.consent, purpose: purpose || null, source: source || null,
      evidenceRef: evidenceRef || null, recordedAt: new Date().toISOString(),
      effectiveAt: input.at && Number.isFinite(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString()
    };
    const rows = this._consents().filter(x => !(x.phone === phone && x.purpose === row.purpose));
    rows.push(row);
    atomicWrite(this.consentFile, rows);
    if (input.consent === false) this.suppress(phone, 'consent withdrawn');
    this._audit('consent_ledger_updated', { phoneMasked: phone.replace(/.(?=.{4})/g, '*'), consent: row.consent, purpose: row.purpose, source: row.source });
    return { ...row, phoneMasked: phone.replace(/.(?=.{4})/g, '*'), phone: undefined };
  }

  suppress(value, reason = 'manual opt-out') {
    const phone = normalizePhone(value);
    if (!/^\\d{7,15}$/.test(phone)) throw new Error('A valid international phone number is required.');
    const rows = this._suppressions().filter(x => x.phone !== phone);
    const row = { id: id('suppression', { phone }), phone, reason: clean(reason, 240) || 'manual opt-out', createdAt: new Date().toISOString(), active: true };
    rows.push(row);
    atomicWrite(this.suppressionFile, rows);
    this._audit('recipient_suppressed', { phoneMasked: phone.replace(/.(?=.{4})/g, '*'), reason: row.reason });
    return { id: row.id, phoneMasked: phone.replace(/.(?=.{4})/g, '*'), reason: row.reason, active: true };
  }

  unsuppress(value, confirmation = '') {
    const phone = normalizePhone(value);
    if (!/^\\d{7,15}$/.test(phone)) throw new Error('A valid international phone number is required.');
    if (clean(confirmation) !== 'CONFIRM RECONSENT') throw new Error('Explicit confirmation text is required to remove a suppression.');
    const rows = this._suppressions().filter(x => x.phone !== phone);
    atomicWrite(this.suppressionFile, rows);
    this._audit('recipient_unsuppressed', { phoneMasked: phone.replace(/.(?=.{4})/g, '*') });
    return { ok: true, removed: rows.length !== this._suppressions().length };
  }

  preflight({ campaignId = null, message = '', contacts = [] } = {}) {
    if (!Array.isArray(contacts)) throw new TypeError('contacts must be an array');
    const body = clean(message, 20000);
    const consents = this._consents();
    const suppressed = new Set(this._suppressions().filter(x => x.active !== false).map(x => x.phone));
    const seen = new Set();
    const recipients = [];
    const counts = { input: contacts.length, eligible: 0, blocked: 0, duplicate: 0, noConsent: 0, optedOut: 0, invalidPhone: 0 };
    for (let index = 0; index < contacts.length; index++) {
      const c = contacts[index] && typeof contacts[index] === 'object' ? contacts[index] : {};
      const phone = normalizePhone(c.phone || c.number);
      const reasons = [];
      if (!/^\\d{7,15}$/.test(phone)) { reasons.push('invalid_phone'); counts.invalidPhone++; }
      if (phone && seen.has(phone)) { reasons.push('duplicate_phone'); counts.duplicate++; }
      if (phone) seen.add(phone);
      const evidence = consents.filter(x => x.phone === phone && x.consent === true);
      const hasPurposeConsent = evidence.some(x => !x.purpose || !c.purpose || x.purpose === clean(c.purpose, 160));
      if (c.consent !== true && !hasPurposeConsent) { reasons.push('consent_evidence_missing'); counts.noConsent++; }
      if (suppressed.has(phone) || c.optOut === true || c.optedOut === true || c.status === 'suppressed') { reasons.push('suppressed_or_opted_out'); counts.optedOut++; }
      if (!body) reasons.push('message_empty');
      const eligible = reasons.length === 0;
      if (eligible) counts.eligible++; else counts.blocked++;
      recipients.push({ index, contactId: clean(c.id, 100) || null, phoneMasked: phone ? phone.replace(/.(?=.{4})/g, '*') : null, eligible, reasons });
    }
    const unresolvedVariables = [...new Set((body.match(/\\{[^{}]{1,80}\\}/g) || []))];
    const blockers = [];
    if (!body) blockers.push('message_empty');
    if (!contacts.length) blockers.push('audience_empty');
    if (!counts.eligible && contacts.length) blockers.push('no_eligible_recipients');
    const result = {
      version: 1, id: id('preflight', { campaignId, count: contacts.length, message: crypto.createHash('sha256').update(body).digest('hex') }),
      campaignId: campaignId == null ? null : clean(campaignId, 100), createdAt: new Date().toISOString(),
      verdict: blockers.length ? 'blocked' : unresolvedVariables.length ? 'review_required' : 'ready_for_operator_review',
      counts, blockers, unresolvedVariables, recipients,
      sendingPerformed: false,
      note: 'Preflight is a local policy check, not proof that consent evidence is authentic or that a provider will deliver messages.'
    };
    this._audit('experimental_campaign_preflight', { id: result.id, campaignId: result.campaignId, verdict: result.verdict, counts });
    return result;
  }

  createDraft(input = {}) {
    const title = clean(input.title, 160);
    const message = clean(input.message, 20000);
    if (!title || !message) throw new Error('Campaign title and message are required.');
    const row = {
      id: clean(input.id, 100) || crypto.randomUUID(),
      title, message, purpose: clean(input.purpose, 160) || null,
      channel: ['whatsapp-web', 'telegram', 'whatsapp-cloud'].includes(input.channel) ? input.channel : 'whatsapp-web',
      status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sendingEnabled: false
    };
    const rows = this._drafts();
    if (rows.some(x => x.id === row.id)) throw new Error('Campaign draft ID already exists.');
    rows.push(row); atomicWrite(this.draftsFile, rows);
    this._audit('experimental_campaign_draft_created', { campaignId: row.id, channel: row.channel });
    return row;
  }
  listDrafts() { return this._drafts().map(x => ({ ...x, message: undefined })); }
}
module.exports = { ConsentCampaignEngine, normalizePhone };
