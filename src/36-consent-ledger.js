'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function digits(value) { return String(value == null ? '' : value).replace(/\D/g, ''); }
function stableHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

class ConsentLedger {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.events = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.events)) this.events = parsed.events;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) {
        const backup = this.filePath + '.corrupt-' + Date.now();
        fs.renameSync(this.filePath, backup);
      }
    }
  }
  _save() {
    const temp = this.filePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, events: this.events }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
  record(input = {}) {
    const phone = digits(input.phone || input.number);
    if (phone.length < 7 || phone.length > 15) throw new Error('A valid phone number is required');
    const decision = String(input.decision || '').toLowerCase();
    if (!['granted', 'revoked', 'opted_out'].includes(decision)) throw new Error('decision must be granted, revoked, or opted_out');
    const channel = String(input.channel || 'whatsapp').trim().slice(0, 40);
    const purpose = String(input.purpose || '').trim().slice(0, 160);
    if (!purpose) throw new Error('purpose is required');
    const event = {
      id: 'consent_' + crypto.randomBytes(10).toString('hex'),
      subjectKey: stableHash(phone),
      phoneMasked: phone.replace(/.(?=.{4})/g, '*'),
      decision, channel, purpose,
      source: String(input.source || 'operator').trim().slice(0, 80),
      evidenceRef: String(input.evidenceRef || '').trim().slice(0, 200) || null,
      recordedAt: new Date().toISOString()
    };
    this.events.push(event);
    this._save();
    return { ...event };
  }
  status(phoneValue, channelValue = null) {
    const phone = digits(phoneValue);
    if (!phone) throw new Error('phone is required');
    const key = stableHash(phone);
    const channel = channelValue ? String(channelValue) : null;
    const events = this.events.filter(e => e.subjectKey === key && (!channel || e.channel === channel)).sort((a,b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    const latest = events[events.length - 1] || null;
    return {
      phoneMasked: phone.replace(/.(?=.{4})/g, '*'),
      channel: channel || latest?.channel || null,
      status: !latest ? 'unknown' : latest.decision === 'granted' ? 'granted' : latest.decision === 'opted_out' ? 'opted_out' : 'revoked',
      latestEvent: latest ? { ...latest } : null,
      history: events.map(e => ({ ...e })),
      eligibleByLedger: Boolean(latest && latest.decision === 'granted')
    };
  }
  summary() {
    const subjects = new Set(this.events.map(e => e.subjectKey));
    return { eventCount: this.events.length, subjectCount: subjects.size, latestEventAt: this.events.at(-1)?.recordedAt || null };
  }
}
module.exports = { ConsentLedger };
