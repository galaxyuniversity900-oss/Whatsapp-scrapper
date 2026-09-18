'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let TelegramClient, StringSession, Api;
try {
  ({ TelegramClient, Api } = require('teleproto'));
  ({ StringSession } = require('teleproto/sessions'));
} catch (e) {
  try {
    ({ TelegramClient, Api } = require('telegram'));
    ({ StringSession } = require('telegram/sessions'));
  } catch (inner) {
    throw new Error('Telegram MTProto client is not installed. Run npm install.');
  }
}

function safeId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
}
function jsonRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function jsonWrite(file, value) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function normalizeEntity(entity) {
  if (!entity) return null;
  return {
    id: String(entity.id ?? ''),
    accessHash: entity.accessHash ? String(entity.accessHash) : null,
    username: entity.username || null,
    title: entity.title || entity.firstName || entity.name || '',
    firstName: entity.firstName || null,
    lastName: entity.lastName || null,
    phone: entity.phone || null,
    type: entity.className || entity.constructor?.name || 'unknown',
    verified: !!entity.verified,
    scam: !!entity.scam,
    fake: !!entity.fake,
    restricted: !!entity.restricted,
    participantsCount: entity.participantsCount ?? null,
    description: entity.about || entity.description || null
  };
}

class TelegramAdapter {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), '.telegram'));
    this.file = path.join(this.dataDir, 'accounts.json');
    this.audit = options.audit || null;
    this.clients = new Map();
    this.auth = new Map();
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  capabilities() {
    return {
      provider: 'telegram',
      adapter: true,
      mtproto: true,
      publicSearch: true,
      dialogs: true,
      messages: true,
      publicMembers: true,
      mediaDownload: true,
      exports: true,
      sendText: true,
      privateDataBypass: false,
      privacyBypass: false
    };
  }

  _accounts() { return jsonRead(this.file, []); }
  _saveAccounts(rows) { jsonWrite(this.file, rows); }

  _key() {
    const master = process.env.TG_MASTER_KEY || process.env.WA_MASTER_KEY || '';
    return master ? crypto.createHash('sha256').update(master).digest() : null;
  }

  _seal(value) {
    const key = this._key();
    if (!key) throw new Error('TG_MASTER_KEY or WA_MASTER_KEY is required before Telegram sessions can be stored.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  _open(row) {
    const key = this._key();
    if (!key || !row) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(row.data, 'base64')), decipher.final()]).toString('utf8');
    } catch { return null; }
  }

  _saveSession(id, session, meta = {}) {
    const rows = this._accounts().filter(x => x.id !== id);
    rows.push({ id, apiId: Number(meta.apiId), session: this._seal(session), phone: meta.phone || null, username: meta.username || null, updatedAt: new Date().toISOString() });
    this._saveAccounts(rows);
  }

  listAccounts() {
    return this._accounts().map(x => ({
      id: x.id, phone: x.phone || null, username: x.username || null,
      connected: !!this.clients.get(x.id), updatedAt: x.updatedAt || null
    }));
  }

  _accountRow(id) { return this._accounts().find(x => x.id === safeId(id)); }

  async _makeClient({ id, apiId, apiHash, session = '' }) {
    if (!Number.isInteger(Number(apiId)) || Number(apiId) <= 0) throw new Error('Telegram API ID is required.');
    if (!String(apiHash || '').trim()) throw new Error('Telegram API hash is required.');
    return new TelegramClient(new StringSession(session || ''), Number(apiId), String(apiHash), {
      connectionRetries: 5,
      requestRetries: 3,
      autoReconnect: true
    });
  }

  async restore(id, apiId, apiHash) {
    const key = safeId(id);
    if (this.clients.has(key)) return { ok: true, id: key, existing: true, status: 'connected' };
    const row = this._accountRow(key);
    if (!row) return { ok: false, id: key, status: 'not_configured' };
    const session = this._open(row.session);
    if (!session) return { ok: false, id: key, status: 'session_locked' };
    const client = await this._makeClient({ id: key, apiId: apiId || row.apiId, apiHash, session });
    await client.connect();
    if (!(await client.checkAuthorization())) return { ok: false, id: key, status: 'authorization_required' };
    this.clients.set(key, client);
    return { ok: true, id: key, status: 'connected', me: normalizeEntity(await client.getMe()) };
  }

  async startLogin({ id, apiId, apiHash, phone }) {
    const key = safeId(id);
    if (!key) throw new Error('Telegram account ID is required.');
    if (this.clients.has(key)) return { ok: true, id: key, status: 'connected' };

    const client = await this._makeClient({ id: key, apiId, apiHash });
    const state = { id: key, phone: String(phone || '').trim(), code: null, password: null, codeWaiters: [], passwordWaiters: [], status: 'waiting_code' };
    if (!/^\\+?[0-9]{7,16}$/.test(state.phone)) throw new Error('Use an international phone number.');
    this.auth.set(key, state);

    const wait = (kind) => new Promise(resolve => state[kind + 'Waiters'].push(resolve));
    const loginPromise = client.start({
      phoneNumber: async () => state.phone,
      phoneCode: async () => state.code || wait('code'),
      password: async () => state.password || wait('password'),
      onError: error => { state.error = String(error?.message || error); }
    }).then(async () => {
      const me = await client.getMe();
      const session = client.session.save();
      this._saveSession(key, session, { apiId, phone: state.phone, username: me?.username || null });
      this.clients.set(key, client);
      state.status = 'connected';
      state.me = normalizeEntity(me);
      this.auth.delete(key);
      if (this.audit) this.audit.append('telegram_account_connected', { accountId: key, username: me?.username || null });
      return { ok: true, id: key, status: 'connected', me: state.me };
    }).catch(error => {
      state.status = 'error';
      state.error = String(error?.message || error);
      return { ok: false, id: key, status: 'error', error: state.error };
    });
    state.loginPromise = loginPromise;
    await new Promise(resolve => setTimeout(resolve, 250));
    return { ok: true, id: key, status: state.status, next: 'code' };
  }

  submitCode(id, code) {
    const state = this.auth.get(safeId(id));
    if (!state) throw new Error('No Telegram login is waiting for a code.');
    state.code = String(code || '').trim();
    for (const resolve of state.codeWaiters.splice(0)) resolve(state.code);
    state.status = 'authorizing';
    return { ok: true, status: state.status };
  }

  submitPassword(id, password) {
    const state = this.auth.get(safeId(id));
    if (!state) throw new Error('No Telegram login is waiting for 2FA password.');
    state.password = String(password || '');
    for (const resolve of state.passwordWaiters.splice(0)) resolve(state.password);
    return { ok: true, status: 'authorizing_2fa' };
  }

  authStatus(id) {
    const key = safeId(id);
    const pending = this.auth.get(key);
    if (pending) return { id: key, status: pending.status, error: pending.error || null };
    const client = this.clients.get(key);
    return { id: key, status: client ? 'connected' : (this._accountRow(key) ? 'stored' : 'not_configured') };
  }

  async disconnect(id, forget = false) {
    const key = safeId(id);
    const client = this.clients.get(key);
    if (client) { try { await client.disconnect(); } catch {} this.clients.delete(key); }
    if (forget) {
      this._saveAccounts(this._accounts().filter(x => x.id !== key));
    }
    this.auth.delete(key);
    return { ok: true, id: key, forgotten: !!forget };
  }

  async clientFor(id) {
    const key = safeId(id);
    const client = this.clients.get(key);
    if (!client) throw new Error('Telegram account is not connected.');
    return client;
  }

  async me(id) { return normalizeEntity(await (await this.clientFor(id)).getMe()); }

  async searchPublic(id, query, limit = 50) {
    const client = await this.clientFor(id);
    const q = String(query || '').trim();
    if (!q) throw new Error('Search query is required.');
    const result = await client.invoke(new Api.contacts.Search({ q, limit: Math.min(100, Math.max(1, Number(limit) || 50)) }));
    return (result?.chats || []).map(normalizeEntity).filter(x => !!x.username);
  }

  async dialogs(id, limit = 100) {
    const client = await this.clientFor(id);
    const out = [];
    for await (const dialog of client.iterDialogs({ limit: Math.min(500, Math.max(1, Number(limit) || 100)) })) {
      out.push({
        id: String(dialog.id),
        name: dialog.name || '',
        title: dialog.title || '',
        username: dialog.entity?.username || null,
        unreadCount: Number(dialog.unreadCount || 0),
        pinned: !!dialog.pinned,
        archived: !!dialog.archived,
        entity: normalizeEntity(dialog.entity)
      });
    }
    return out;
  }

  async resolve(id, usernameOrId) {
    const client = await this.clientFor(id);
    const entity = await client.getEntity(String(usernameOrId || '').trim());
    return normalizeEntity(entity);
  }

  async messages(id, target, options = {}) {
    const client = await this.clientFor(id);
    const entity = await client.getEntity(String(target || '').trim());
    const rows = [];
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 100));
    for await (const message of client.iterMessages(entity, {
      limit,
      search: options.search ? String(options.search) : undefined,
      reverse: !!options.reverse
    })) {
      rows.push({
        id: String(message.id),
        date: message.date ? new Date(message.date).toISOString() : null,
        text: message.message || '',
        senderId: message.senderId ? String(message.senderId) : null,
        views: message.views ?? null,
        forwards: message.forwards ?? null,
        replies: message.replies?.replies ?? null,
        editDate: message.editDate ? new Date(message.editDate).toISOString() : null,
        media: message.media ? message.media.className || message.media.constructor?.name || 'media' : null,
        groupedId: message.groupedId ? String(message.groupedId) : null
      });
    }
    return rows;
  }

  async publicMembers(id, target, limit = 500) {
    const client = await this.clientFor(id);
    const entity = await client.getEntity(String(target || '').trim());
    if (!entity?.username) throw new Error('Public-member enumeration requires a public username. Private/invite-only participant scraping is disabled.');
    const rows = [];
    for await (const user of client.iterParticipants(entity, { limit: Math.min(5000, Math.max(1, Number(limit) || 500)) })) {
      rows.push(normalizeEntity(user));
    }
    return rows;
  }

  async channelInfo(id, target) {
    return this.resolve(id, target);
  }

  async downloadMedia(id, target, messageId, outputDir) {
    const client = await this.clientFor(id);
    const entity = await client.getEntity(String(target || '').trim());
    const message = await client.getMessages(entity, { ids: [Number(messageId)] });
    const item = Array.isArray(message) ? message[0] : message;
    if (!item) throw new Error('Telegram message not found.');
    const dir = path.resolve(outputDir || path.join(this.dataDir, 'media'));
    fs.mkdirSync(dir, { recursive: true });
    const file = await client.downloadMedia(item, { outputFile: path.join(dir, String(item.id)) });
    return { ok: true, file: file || null, messageId: Number(messageId) };
  }

  async sendText(id, target, text) {
    const client = await this.clientFor(id);
    const body = String(text || '').trim();
    if (!body) throw new Error('Message text is empty.');
    const entity = await client.getEntity(String(target || '').trim());
    const message = await client.sendMessage(entity, { message: body });
    return { id: String(message.id), date: message.date ? new Date(message.date).toISOString() : null };
  }

  async exportRows(rows, format, outputFile) {
    const { exportData } = require('./11-exporter');
    const normalized = String(format || 'json').toLowerCase();
    const ext = normalized === 'excel' ? 'xls' : normalized;
    const output = path.resolve(outputFile);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    return exportData(rows, normalized, output, 'Telegram export');
  }

  adapter(id) {
    return {
      provider: 'telegram',
      capabilities: this.capabilities(),
      listDialogs: (limit) => this.dialogs(id, limit),
      searchPublic: (query, limit) => this.searchPublic(id, query, limit),
      resolve: (target) => this.resolve(id, target),
      fetchMessages: (target, options) => this.messages(id, target, options),
      listPublicMembers: (target, limit) => this.publicMembers(id, target, limit),
      getChannelInfo: (target) => this.channelInfo(id, target),
      downloadMedia: (target, messageId, dir) => this.downloadMedia(id, target, messageId, dir),
      sendText: (target, text) => this.sendText(id, target, text)
    };
  }

  async shutdown() {
    for (const [id, client] of this.clients) {
      try { await client.disconnect(); } catch {}
      this.clients.delete(id);
    }
  }
}

module.exports = { TelegramAdapter, normalizeEntity };
