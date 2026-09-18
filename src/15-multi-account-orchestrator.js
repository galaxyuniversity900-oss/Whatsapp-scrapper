'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ACCOUNTS = Math.min(100, Math.max(11, Number(process.env.WA_MAX_ACCOUNTS || 50)));

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 15);
}

function keyFromEnv() {
  const raw = process.env.WA_MASTER_KEY || '';
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(value) {
  const key = keyFromEnv();
  if (!key) throw new Error('WA_MASTER_KEY is required to persist WhatsApp Cloud API credentials');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

function decryptSecret(value) {
  const key = keyFromEnv();
  if (!key || !value?.data) throw new Error('WA_MASTER_KEY is required to decrypt WhatsApp Cloud API credentials');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

class MultiAccountOrchestrator {
  constructor(file) {
    this.file = path.resolve(file);
    this.scheduleFile = path.join(path.dirname(this.file), 'account-schedules.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.timers = new Map();
    this.schedules = this._readSchedules();
  }

  _readSchedules() {
    try { return fs.existsSync(this.scheduleFile) ? JSON.parse(fs.readFileSync(this.scheduleFile, 'utf8')) : []; }
    catch { return []; }
  }

  _writeSchedules() {
    const tmp = this.scheduleFile + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(this.schedules, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.scheduleFile);
  }

  count(registry) {
    return registry.list().length;
  }

  assertCapacity(registry, id) {
    const exists = registry.get(id);
    if (!exists && this.count(registry) >= MAX_ACCOUNTS) {
      throw new Error('Maximum configured account capacity reached: ' + MAX_ACCOUNTS);
    }
  }

  sanitizeConfig(input) {
    const transport = String(input.transport || input.authMode || 'web_qr').toLowerCase();
    if (!['web_qr', 'web_pairing', 'cloud_api'].includes(transport)) throw new Error('Unsupported account transport');
    const id = String(input.id || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
    if (!id) throw new Error('Account ID required');

    const row = {
      id,
      transport,
      enabled: input.enabled !== false,
      browser: input.browser || 'chromium',
      headless: input.headless === true,
      executablePath: input.executablePath || null,
      proxyUrl: input.proxyUrl || null,
      phoneNumber: normalizePhone(input.phoneNumber),
      cloud: null,
      createdAt: new Date().toISOString()
    };

    if (transport === 'web_pairing' && !/^\d{7,15}$/.test(row.phoneNumber)) {
      throw new Error('Pairing-code mode requires an international phone number (digits only)');
    }

    if (transport === 'cloud_api') {
      const phoneNumberId = String(input.phoneNumberId || '').trim();
      const accessToken = String(input.accessToken || '').trim();
      const apiVersion = String(input.apiVersion || process.env.WA_GRAPH_API_VERSION || 'v23.0').trim();
      if (!phoneNumberId || !accessToken) throw new Error('Cloud API requires phone number ID and access token');
      if (!/^v\d+\.\d+$/.test(apiVersion)) throw new Error('Invalid Graph API version');
      row.cloud = {
        phoneNumberId,
        apiVersion,
        accessToken: encryptSecret(accessToken),
        businessAccountId: String(input.businessAccountId || '').trim() || null
      };
    }
    return row;
  }

  publicConfig(row) {
    if (!row) return null;
    return {
      id: row.id,
      transport: row.transport,
      enabled: row.enabled !== false,
      browser: row.browser,
      headless: !!row.headless,
      phoneNumber: row.phoneNumber || '',
      cloud: row.cloud ? {
        phoneNumberId: row.cloud.phoneNumberId,
        apiVersion: row.cloud.apiVersion,
        businessAccountId: row.cloud.businessAccountId || null,
        hasAccessToken: true
      } : null,
      createdAt: row.createdAt
    };
  }

  schedule(id, runAt, action, payload) {
    const when = new Date(runAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) throw new Error('Schedule time must be a valid future date/time');
    const schedule = {
      id: 'sched-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      accountId: String(id),
      runAt: when.toISOString(),
      action: String(action || 'send'),
      payload: payload || {},
      status: 'scheduled',
      createdAt: new Date().toISOString()
    };
    this.schedules.push(schedule);
    this._writeSchedules();
    return schedule;
  }

  cancelSchedule(id) {
    const row = this.schedules.find(x => x.id === String(id));
    if (!row) throw new Error('Schedule not found');
    row.status = 'cancelled';
    if (this.timers.has(row.id)) {
      clearTimeout(this.timers.get(row.id));
      this.timers.delete(row.id);
    }
    this._writeSchedules();
    return row;
  }

  listSchedules() {
    return this.schedules.slice().sort((a, b) => a.runAt.localeCompare(b.runAt));
  }

  startDueSchedules(run) {
    for (const row of this.schedules) {
      if (row.status !== 'scheduled') continue;
      const ms = Math.max(0, new Date(row.runAt).getTime() - Date.now());
      const timer = setTimeout(async () => {
        this.timers.delete(row.id);
        if (row.status !== 'scheduled') return;
        row.status = 'running';
        this._writeSchedules();
        try {
          await run(row);
          row.status = 'completed';
        } catch (e) {
          row.status = 'failed';
          row.error = String(e.message || e);
        }
        row.finishedAt = new Date().toISOString();
        this._writeSchedules();
      }, Math.min(ms, 2147483647));
      this.timers.set(row.id, timer);
    }
  }

  async sendCloud(row, to, body, options = {}) {
    if (!row?.cloud) throw new Error('Cloud API configuration missing');
    const token = decryptSecret(row.cloud.accessToken);
    const url = 'https://graph.facebook.com/' + row.cloud.apiVersion + '/' + row.cloud.phoneNumberId + '/messages';
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizePhone(to),
      type: 'text',
      text: { preview_url: !!options.previewUrl, body: String(body) }
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error('WhatsApp Cloud API ' + response.status + ': ' + (data?.error?.message || JSON.stringify(data)));
    }
    return data;
  }

  async healthCloud(row) {
    if (!row?.cloud) return { ready: false, reason: 'Cloud API configuration missing' };
    const token = decryptSecret(row.cloud.accessToken);
    const url = 'https://graph.facebook.com/' + row.cloud.apiVersion + '/' + row.cloud.phoneNumberId;
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json().catch(() => ({}));
    return {
      ready: response.ok,
      status: response.status,
      phoneNumberId: row.cloud.phoneNumberId,
      displayPhoneNumber: data.display_phone_number || null,
      verifiedName: data.verified_name || null,
      error: response.ok ? null : (data?.error?.message || JSON.stringify(data))
    };
  }
}

module.exports = { MultiAccountOrchestrator, MAX_ACCOUNTS };
