'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readRows(file) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

class DurableDeliveryQueue {
  constructor(file, { maxAttempts = 4, baseDelayMs = 2000, maxDelayMs = 300000, audit = null } = {}) {
    this.file = path.resolve(file);
    this.maxAttempts = Math.max(1, Math.min(10, Number(maxAttempts) || 4));
    this.baseDelayMs = Math.max(100, Number(baseDelayMs) || 2000);
    this.maxDelayMs = Math.max(this.baseDelayMs, Number(maxDelayMs) || 300000);
    this.audit = audit;
    this.paused = false;
    this.stopped = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }
  _rows() { return readRows(this.file); }
  _save(rows) { atomicWrite(this.file, rows); }
  enqueue({ id, idempotencyKey, provider, recipientRef, payload, notBefore = Date.now() } = {}) {
    const key = String(idempotencyKey || id || '').trim();
    if (!key) throw new Error('idempotencyKey is required.');
    if (!provider || !recipientRef || !payload || typeof payload !== 'object') throw new Error('provider, recipientRef, and payload are required.');
    const rows = this._rows();
    const existing = rows.find(x => x.idempotencyKey === key);
    if (existing) return { ...existing, duplicate: true };
    const row = {
      id: String(id || crypto.randomUUID()), idempotencyKey: key,
      provider: String(provider).slice(0, 80), recipientRef: String(recipientRef).slice(0, 160),
      payload, payloadHash: hash(JSON.stringify(payload)), status: 'queued', attempts: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      nextAttemptAt: new Date(Math.max(Date.now(), Number(notBefore) || Date.now())).toISOString(),
      lastError: null
    };
    rows.push(row); this._save(rows);
    this.audit?.append?.('delivery_queued', { id: row.id, provider: row.provider, payloadHash: row.payloadHash });
    return { ...row, duplicate: false };
  }
  pause() { this.paused = true; return this.status(); }
  resume() { if (this.stopped) throw new Error('A stopped queue cannot be resumed; create a new queue instance.'); this.paused = false; return this.status(); }
  stop() { this.stopped = true; this.paused = true; return this.status(); }
  status() {
    const rows = this._rows();
    return { paused: this.paused, stopped: this.stopped, total: rows.length, queued: rows.filter(x => x.status === 'queued').length, retrying: rows.filter(x => x.status === 'retrying').length, delivered: rows.filter(x => x.status === 'delivered').length, failed: rows.filter(x => x.status === 'failed').length };
  }
  list({ limit = 100, status = null } = {}) {
    const rows = this._rows().filter(x => !status || x.status === status).slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    return rows.map(({ payload, ...row }) => ({ ...row, payload: undefined }));
  }
  async processDue(sender, { now = Date.now(), concurrency = 1, maxPerRun = 50 } = {}) {
    if (typeof sender !== 'function') throw new TypeError('sender must be a function.');
    if (this.stopped || this.paused) return { processed: 0, skipped: true, reason: this.stopped ? 'stopped' : 'paused', status: this.status() };
    const width = Math.max(1, Math.min(5, Number(concurrency) || 1));
    const rows = this._rows();
    const due = rows.filter(x => ['queued', 'retrying'].includes(x.status) && Date.parse(x.nextAttemptAt) <= now && x.attempts < this.maxAttempts).slice(0, Math.max(1, Math.min(200, Number(maxPerRun) || 50)));
    let cursor = 0;
    let processed = 0;
    const worker = async () => {
      while (cursor < due.length && !this.stopped && !this.paused) {
        const item = due[cursor++];
        const currentRows = this._rows();
        const index = currentRows.findIndex(x => x.id === item.id);
        if (index < 0 || !['queued', 'retrying'].includes(currentRows[index].status)) continue;
        currentRows[index] = { ...currentRows[index], status: 'processing', attempts: currentRows[index].attempts + 1, updatedAt: new Date().toISOString() };
        this._save(currentRows);
        const claimed = currentRows[index];
        try {
          const result = await sender({ ...claimed });
          const latest = this._rows();
          const at = latest.findIndex(x => x.id === claimed.id);
          if (at >= 0) latest[at] = { ...latest[at], status: 'delivered', providerResult: result == null ? null : result, deliveredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError: null };
          this._save(latest);
          this.audit?.append?.('delivery_queue_delivered', { id: claimed.id, attempts: claimed.attempts });
        } catch (error) {
          const latest = this._rows();
          const at = latest.findIndex(x => x.id === claimed.id);
          if (at >= 0) {
            const exhausted = latest[at].attempts >= this.maxAttempts;
            const delay = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** Math.max(0, latest[at].attempts - 1)));
            latest[at] = { ...latest[at], status: exhausted ? 'failed' : 'retrying', nextAttemptAt: new Date(Date.now() + delay).toISOString(), lastError: String(error?.message || error).slice(0, 300), updatedAt: new Date().toISOString() };
            this._save(latest);
            this.audit?.append?.(exhausted ? 'delivery_queue_failed' : 'delivery_queue_retry_scheduled', { id: claimed.id, attempts: claimed.attempts, delayMs: delay });
          }
        }
        processed++;
      }
    };
    await Promise.all(Array.from({ length: width }, () => worker()));
    return { processed, skipped: false, status: this.status() };
  }
}
module.exports = { DurableDeliveryQueue };
