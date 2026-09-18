'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { BrowserManager } = require('./3-browser-selection-fix');
const { ContactStateManager } = require('./1-state-persistence-fix');
const { ContactPolicy } = require('./5-contact-policy');
const { AuditLog } = require('./6-audit-log');
const { DeliveryTracker } = require('./8-delivery-tracker');
const { AccountRegistry } = require('./9-account-registry');
const { DataCollector } = require('./10-data-collector');
const { WhatsAppDirectory } = require('./12-whatsapp-directory');
const { GroupIntelligence } = require('./13-group-intelligence');

const ROOT = path.resolve(process.env.WA_DATA_DIR || path.join(os.homedir(), '.whatsapp-scrapper'));
const dataDir = path.join(ROOT, 'data');
const mediaDir = path.join(ROOT, 'media');
const authDir = path.join(dataDir, 'auth');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(authDir, { recursive: true });

const state = new ContactStateManager(path.join(dataDir, 'contacts.json'));
const policy = new ContactPolicy(path.join(dataDir, 'contacts.json'));
const audit = new AuditLog(path.join(dataDir, 'audit.log'));
const delivery = new DeliveryTracker(path.join(dataDir, 'delivery.json'));
const registry = new AccountRegistry(path.join(dataDir, 'accounts.json'));
const collector = new DataCollector(path.join(dataDir, 'whatsapp-data'));
const directory = new WhatsAppDirectory({ includeProfiles: true });
const groupIntelligence = new GroupIntelligence(path.join(dataDir, 'whatsapp-data', 'group-intelligence.json'));

const sessions = new Map();
const listeners = new Set();
const campaigns = new Map();
const serverStartedAt = new Date().toISOString();

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}
function html(res, data) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function broadcast(event, data) {
  const line = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of listeners) {
    try { res.write(line); } catch { listeners.delete(res); }
  }
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 30 * 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function normalizeId(id) {
  return String(id || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
}
function safeFileName(name) {
  return String(name || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function delayMs(min, max) {
  const lo = Math.max(0, Number(min) || 0);
  const hi = Math.max(lo, Number(max) || lo);
  return Math.floor((Math.random() * (hi - lo + 1) + lo) * 1000);
}
function campaignState(accountId) {
  return campaigns.get(String(accountId)) || {
    accountId: String(accountId), status: 'idle', sent: 0, total: 0, failed: 0,
    startedAt: null, finishedAt: null, paused: false, stopped: false
  };
}
function emitCampaign(accountId, patch) {
  const current = campaignState(accountId);
  const next = { ...current, ...patch, accountId: String(accountId) };
  campaigns.set(String(accountId), next);
  broadcast('campaign:status', next);
  broadcast('campaign:progress', next);
  return next;
}
function sessionPublic(s) {
  return {
    id: s.id,
    status: s.status,
    browser: s.browser,
    headless: s.headless,
    waState: s.waState || null,
    sent: s.sent || 0,
    consecutiveFailures: s.consecutiveFailures || 0,
    authenticated: ['authenticated', 'ready'].includes(s.status),
    campaign: campaignState(s.id),
    qr: !!s.lastQr
  };
}

async function createSession(input = {}) {
  const id = normalizeId(input.id);
  if (!id) throw new Error('Account ID required');
  const existing = sessions.get(id);
  if (existing) return { ok: true, id, existing: true, session: sessionPublic(existing) };

  const browser = input.browser || 'chromium';
  const headless = input.headless === true;
  const executablePath = input.executablePath || process.env.CHROME_BIN || null;
  if (!['chromium', 'chrome', 'edge'].includes(browser)) throw new Error('Unsupported browser');

  const manager = new BrowserManager({
    browser,
    headless,
    executablePath,
    proxyUrl: input.proxyUrl || null
  });
  const detected = BrowserManager.detectInstalledBrowsers();
  const browserInfo = detected[browser];
  if (!executablePath && !browserInfo?.available) {
    throw new Error(
      'Browser executable not found for ' + browser +
      '. Install Chromium/Chrome or set CHROME_BIN to its executable path.'
    );
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: id, dataPath: authDir }),
    puppeteer: manager.puppeteerOptions()
  });

  const s = {
    id, client, browser, headless, manager, status: 'initializing',
    sent: 0, consecutiveFailures: 0, paused: false, stopped: false,
    lastQr: null, createdAt: new Date().toISOString()
  };
  sessions.set(id, s);
  registry.upsert({ id, browser, headless, enabled: true });

  client.on('qr', async qr => {
    try {
      s.lastQr = await qrcode.toDataURL(qr, { margin: 2, width: 420 });
      s.status = 'qr';
      audit.append('account_qr_generated', { accountId: id });
      broadcast('session:qr', { id, qr: s.lastQr });
      broadcast('session:status', sessionPublic(s));
    } catch (e) {
      broadcast('session:error', { id, error: String(e.message || e) });
    }
  });
  client.on('authenticated', () => {
    s.status = 'authenticated';
    s.lastQr = null;
    audit.append('account_authenticated', { accountId: id });
    broadcast('session:status', sessionPublic(s));
  });
  client.on('ready', async () => {
    s.status = 'ready';
    s.lastQr = null;
    s.consecutiveFailures = 0;
    try { s.waState = await client.getState(); } catch {}
    audit.append('account_ready', { accountId: id, browser });
    broadcast('session:status', sessionPublic(s));
  });
  client.on('change_state', waState => {
    s.waState = waState;
    broadcast('session:status', sessionPublic(s));
  });
  client.on('auth_failure', reason => {
    s.status = 'auth_failure';
    audit.append('account_auth_failure', { accountId: id, reason: String(reason) });
    broadcast('session:error', { id, error: String(reason) });
    broadcast('session:status', sessionPublic(s));
  });
  client.on('disconnected', reason => {
    s.status = 'disconnected';
    audit.append('account_disconnected', { accountId: id, reason: String(reason) });
    broadcast('session:status', { id, status: s.status, reason: String(reason) });
    sessions.delete(id);
  });
  client.on('message_ack', (message, ack) => {
    const messageId = message?.id?._serialized;
    if (!messageId) return;
    const row = delivery.ack(messageId, ack);
    audit.append('message_ack', { accountId: id, messageId, ack });
    broadcast('delivery:ack', {
      accountId: id, messageId, ack, status: row?.status || 'acknowledged'
    });
  });
  client.on('message_create', async message => {
    try {
      const chat = await message.getChat();
      const row = collector.ingest(message, chat);
      if (message?.type === 'gp2') {
        const raw = message.rawData || message._data || {};
        const recipients = raw.recipients || [];
        const subtype = raw.subtype || '';
        if (recipients.length && ['add', 'invite', 'linked_group_join', 'join'].includes(subtype)) {
          groupIntelligence.recordJoin({
            id: message.id,
            chatId: chat?.id,
            author: message.author || raw.author,
            recipientIds: recipients,
            timestamp: message.timestamp
          }, subtype);
        }
      }
      broadcast('message:stream', { accountId: id, row });
    } catch (e) {
      audit.append('message_collect_error', { accountId: id, error: String(e.message || e) });
    }
  });
  client.on('message_reaction', reaction => {
    try {
      groupIntelligence.recordReaction(reaction, reaction?.msgId ? { from: reaction.msgId } : {});
      broadcast('reaction:stream', { accountId: id, reaction });
    } catch (e) {
      audit.append('reaction_collect_error', { accountId: id, error: String(e.message || e) });
    }
  });
  client.on('message', message => {
    broadcast('message:received', {
      accountId: id,
      from: message?.from || '',
      body: message?.body || '',
      messageId: message?.id?._serialized || '',
      timestamp: message?.timestamp || Date.now()
    });
  });

  try {
    await client.initialize();
    audit.append('account_initialize_started', { accountId: id, browser });
    return { ok: true, id, session: sessionPublic(s) };
  } catch (e) {
    sessions.delete(id);
    try { await client.destroy(); } catch {}
    audit.append('account_initialize_error', { accountId: id, error: String(e.message || e) });
    throw e;
  }
}

async function logoutSession(id, removeAuth = false) {
  const key = normalizeId(id);
  const s = sessions.get(key);
  if (s) {
    try { await s.client.logout(); } catch {}
    try { await s.client.destroy(); } catch {}
    sessions.delete(key);
  }
  registry.upsert({ id: key, enabled: false });
  if (removeAuth) {
    try { fs.rmSync(path.join(authDir, 'session-' + key), { recursive: true, force: true }); } catch {}
    registry.remove(key);
  }
  audit.append(removeAuth ? 'account_deleted' : 'account_logout', { accountId: key });
  broadcast('session:status', { id: key, status: removeAuth ? 'deleted' : 'logged_out' });
  return { ok: true };
}

async function sendCampaign(payload = {}) {
  const accountId = String(payload.accountId || '');
  const s = sessions.get(accountId);
  if (!s || s.status !== 'ready') throw new Error('Account is not ready');
  if (campaigns.get(accountId)?.status === 'running' || campaigns.get(accountId)?.status === 'paused') {
    throw new Error('A campaign is already running for this account');
  }

  const all = await state.readContacts();
  const limit = Math.min(10000, Math.max(1, Number(payload.limit || 100)));
  const eligible = policy.filterEligible(all).slice(0, limit);
  const text = String(payload.template || '').trim();
  const mediaPaths = (Array.isArray(payload.mediaPaths) ? payload.mediaPaths : [])
    .filter(p => typeof p === 'string' && fs.existsSync(p));
  if (!text && !mediaPaths.length) throw new Error('Campaign message is empty');

  const minDelay = Math.max(0, Number(payload.minDelay ?? 15));
  const maxDelay = Math.max(minDelay, Number(payload.maxDelay ?? 30));
  const parallel = payload.parallel === true;
  const concurrency = Math.min(5, Math.max(1, Number(payload.concurrency || 2)));

  emitCampaign(accountId, {
    status: 'running', sent: 0, total: eligible.length, failed: 0,
    startedAt: new Date().toISOString(), finishedAt: null, paused: false, stopped: false
  });
  s.paused = false;
  s.stopped = false;
  s.sent = 0;
  s.consecutiveFailures = 0;
  audit.append('campaign_started', {
    accountId, total: eligible.length, minDelay, maxDelay, parallel, concurrency
  });

  const results = new Array(eligible.length);
  let cursor = 0;
  let active = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      const n = cursor++;
      if (n >= eligible.length) return;
      const item = eligible[n];
      while (s.paused && !s.stopped) await sleep(250);
      if (s.stopped) {
        results[n] = { index: item.index, status: 'stopped' };
        done++;
        continue;
      }

      const contact = item.contact;
      const phone = policy.normalizePhone(contact.phone);
      const result = { index: item.index, phone, status: 'failed' };
      try {
        if (!/^\d{7,15}$/.test(phone)) throw new Error('Invalid phone number');
        const bodyText = text
          .replace(/\{name\}/gi, contact.name || '')
          .replace(/\{phone\}/gi, contact.phone || '');
        const chatId = phone + '@c.us';
        let sentMessage = null;
        if (mediaPaths.length) {
          let first = true;
          for (const mediaPath of mediaPaths) {
            const media = MessageMedia.fromFilePath(mediaPath);
            sentMessage = await s.client.sendMessage(
              chatId, media, first ? { caption: bodyText } : undefined
            );
            first = false;
          }
        } else {
          sentMessage = await s.client.sendMessage(chatId, bodyText);
        }

        const messageId = sentMessage?.id?._serialized ||
          ('local-' + accountId + '-' + item.index + '-' + Date.now());
        delivery.create({
          id: messageId, accountId, phone: contact.phone, contactIndex: item.index
        });
        await state.updateContactStatus(item.index, 'sent', {
          lastSentAt: new Date().toISOString(), error: undefined
        });
        s.sent++;
        s.consecutiveFailures = 0;
        result.status = 'sent';
        result.messageId = messageId;
        audit.append('message_sent', { accountId, phone: contact.phone, messageId });
      } catch (e) {
        s.consecutiveFailures++;
        result.error = String(e.message || e);
        await state.updateContactStatus(item.index, 'failed', {
          error: result.error, lastFailedAt: new Date().toISOString()
        });
        audit.append('message_failed', {
          accountId, phone: contact.phone, error: result.error,
          consecutiveFailures: s.consecutiveFailures
        });
        if (s.consecutiveFailures >= 5) {
          s.stopped = true;
          audit.append('campaign_circuit_breaker', {
            accountId, reason: 'consecutive_failures', count: s.consecutiveFailures
          });
        }
      }
      results[n] = result;
      done++;
      const failed = results.filter(Boolean).filter(x => x.status === 'failed').length;
      emitCampaign(accountId, {
        sent: s.sent, total: eligible.length, failed,
        status: s.stopped ? 'stopped' : (s.paused ? 'paused' : 'running')
      });
      if (!s.stopped && done < eligible.length) await sleep(delayMs(minDelay, maxDelay));
    }
  };

  const workerCount = parallel ? concurrency : 1;
  active = Math.min(workerCount, eligible.length);
  await Promise.all(Array.from({ length: active }, worker));
  const failed = results.filter(Boolean).filter(x => x.status === 'failed').length;
  const stopped = s.stopped || results.some(x => x?.status === 'stopped');
  const finalStatus = stopped ? 'stopped' : 'completed';
  const final = emitCampaign(accountId, {
    status: finalStatus, sent: s.sent, total: eligible.length, failed,
    finishedAt: new Date().toISOString(), paused: false, stopped
  });
  audit.append('campaign_completed', {
    accountId, sent: s.sent, total: eligible.length, failed, status: finalStatus
  });
  broadcast('campaign:done', { ...final, results });
  return results;
}

function parseCsv(raw) {
  const lines = String(raw).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parse = line => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
  const headers = parse(lines.shift()).map(x => x.trim().toLowerCase());
  return lines.map(line => {
    const values = parse(line); const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

async function importContacts(payload) {
  let rows = Array.isArray(payload.contacts) ? payload.contacts : [];
  if (typeof payload.csv === 'string') rows = parseCsv(payload.csv);
  const incoming = rows.map(x => ({
    ...x,
    phone: policy.normalizePhone(x.phone),
    consent: x.consent === true || /^(1|true|yes|y)$/i.test(String(x.consent || '')),
    status: x.status || 'pending'
  })).filter(x => policy.validate(x).valid);

  const mergedRows = [...await state.readContacts(), ...incoming];
  const seen = new Set();
  const merged = [];
  for (const row of mergedRows) {
    const phone = policy.normalizePhone(row.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    merged.push({ ...row, phone });
  }
  await state.writeContacts(merged);
  audit.append('contacts_imported', { count: incoming.length, total: merged.length, source: 'web' });
  return { ok: true, imported: incoming.length, total: merged.length, contacts: merged };
}

async function requireReady(accountId) {
  const s = sessions.get(String(accountId || ''));
  if (!s || s.status !== 'ready') throw new Error('Account is not ready');
  return s;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET' && p === '/') {
    return html(res, fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  }
  if (req.method === 'GET' && p === '/manifest.json') {
    return json(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'web', 'manifest.json'), 'utf8')));
  }
  if (req.method === 'GET' && p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'web', 'sw.js'), 'utf8'));
  }
  if (req.method === 'GET' && p === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  try {
    if (req.method === 'GET' && p === '/api/health') {
      return json(res, 200, {
        ok: true, platform: process.platform, node: process.version,
        root: ROOT, startedAt: serverStartedAt,
        sessions: sessions.size, accounts: registry.list().length
      });
    }
    if (req.method === 'GET' && p === '/api/browser') {
      return json(res, 200, BrowserManager.detectInstalledBrowsers());
    }
    if (req.method === 'GET' && p === '/api/sessions') {
      return json(res, 200, [...sessions.values()].map(sessionPublic));
    }
    if (req.method === 'GET' && p === '/api/accounts') {
      return json(res, 200, registry.list());
    }
    if (req.method === 'GET' && p === '/api/contacts') {
      return json(res, 200, await state.readContacts());
    }
    if (req.method === 'GET' && p === '/api/data/summary') {
      return json(res, 200, collector.summary());
    }
    if (req.method === 'GET' && p === '/api/data/messages') {
      return json(res, 200, collector.listMessages(Math.min(1000, Number(url.searchParams.get('limit') || 200))));
    }
    if (req.method === 'GET' && p === '/api/data/chats') return json(res, 200, collector.listChats());
    if (req.method === 'GET' && p === '/api/data/profiles') return json(res, 200, collector.listProfiles());
    if (req.method === 'GET' && p === '/api/data/groups') return json(res, 200, collector.listGroups());
    if (req.method === 'GET' && p === '/api/data/contacts') return json(res, 200, collector.listContacts());
    if (req.method === 'GET' && p === '/api/delivery') {
      return json(res, 200, delivery.list(Math.min(1000, Number(url.searchParams.get('limit') || 200))));
    }
    if (req.method === 'GET' && p === '/api/delivery/summary') return json(res, 200, delivery.summary());
    if (req.method === 'GET' && p === '/api/campaign/status') {
      return json(res, 200, [...campaigns.values()]);
    }
    if (req.method === 'GET' && p === '/api/audit') {
      return json(res, 200, audit.read(Math.min(1000, Number(url.searchParams.get('limit') || 200))));
    }
    if (req.method === 'GET' && p === '/api/media') {
      const files = fs.readdirSync(mediaDir).map(name => {
        const file = path.join(mediaDir, name);
        const stat = fs.statSync(file);
        return { name, size: stat.size, path: file, modifiedAt: stat.mtime.toISOString() };
      });
      return json(res, 200, files);
    }
    if (req.method === 'GET' && p === '/api/runtime') {
      return json(res, 200, {
        health: { sessions: sessions.size, accounts: registry.list().length },
        sessions: [...sessions.values()].map(sessionPublic),
        delivery: delivery.summary(),
        data: collector.summary(),
        campaigns: [...campaigns.values()]
      });
    }

    if (req.method === 'POST' && p === '/api/session/create') {
      return json(res, 200, await createSession(await parseBody(req)));
    }
    if (req.method === 'POST' && p === '/api/session/logout') {
      const x = await parseBody(req);
      return json(res, 200, await logoutSession(x.id, false));
    }
    if (req.method === 'POST' && p === '/api/session/delete') {
      const x = await parseBody(req);
      return json(res, 200, await logoutSession(x.id, true));
    }
    if (req.method === 'POST' && p === '/api/session/readiness') {
      const x = await parseBody(req);
      const s = sessions.get(normalizeId(x.id));
      if (!s) return json(res, 200, { ready: false, reason: 'Account is not connected' });
      let waState = s.waState || null;
      try { waState = await s.client.getState(); } catch {}
      return json(res, 200, {
        ready: s.status === 'ready' && waState === 'CONNECTED',
        status: s.status, waState, browser: s.browser,
        authenticated: ['authenticated', 'ready'].includes(s.status),
        canCampaign: s.status === 'ready' && waState === 'CONNECTED'
      });
    }

    if (req.method === 'POST' && p === '/api/campaign/start') {
      const x = await parseBody(req);
      return json(res, 200, { ok: true, results: await sendCampaign(x) });
    }
    if (req.method === 'POST' && p === '/api/campaign/pause') {
      const x = await parseBody(req); const s = sessions.get(String(x.accountId || ''));
      if (!s) throw new Error('Account not found');
      s.paused = true;
      emitCampaign(s.id, { paused: true, status: 'paused' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/campaign/resume') {
      const x = await parseBody(req); const s = sessions.get(String(x.accountId || ''));
      if (!s) throw new Error('Account not found');
      s.paused = false;
      emitCampaign(s.id, { paused: false, status: 'running' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/campaign/stop') {
      const x = await parseBody(req); const s = sessions.get(String(x.accountId || ''));
      if (!s) throw new Error('Account not found');
      s.stopped = true; s.paused = false;
      emitCampaign(s.id, { stopped: true, paused: false, status: 'stopped' });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/contacts/import') {
      return json(res, 200, await importContacts(await parseBody(req)));
    }
    if (req.method === 'POST' && p === '/api/contacts/suppress') {
      const x = await parseBody(req);
      const phone = policy.normalizePhone(x.phone);
      const changed = policy.suppressPhone(phone, x.reason || 'manual opt-out');
      if (changed) audit.append('contact_suppressed', { phone, reason: x.reason || 'manual opt-out' });
      return json(res, 200, { ok: true, changed });
    }
    if (req.method === 'POST' && p === '/api/media/upload') {
      const x = await parseBody(req);
      if (typeof x.data !== 'string' || !x.data) throw new Error('Media data required');
      const comma = x.data.indexOf(',');
      const buffer = Buffer.from(comma >= 0 ? x.data.slice(comma + 1) : x.data, 'base64');
      if (buffer.length > 20 * 1024 * 1024) throw new Error('Media file exceeds 20 MB');
      const name = Date.now() + '-' + safeFileName(x.name);
      const file = path.join(mediaDir, name);
      fs.writeFileSync(file, buffer);
      return json(res, 200, { ok: true, name, size: buffer.length, path: file });
    }

    if (req.method === 'POST' && p === '/api/data/sync/contacts') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const rows = await directory.listContacts(s.client, { includeProfiles: x.includeProfiles !== false });
      collector.saveContacts(rows);
      audit.append('directory_contacts_synced', { accountId: s.id, count: rows.length });
      broadcast('data:sync:done', { type: 'contacts', count: rows.length });
      return json(res, 200, { ok: true, count: rows.length, rows });
    }
    if (req.method === 'POST' && p === '/api/data/sync/groups') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const rows = await directory.listGroups(s.client, {
        includeMembers: x.includeMembers !== false, includeProfiles: !!x.includeProfiles
      });
      collector.saveGroups(rows);
      audit.append('directory_groups_synced', { accountId: s.id, count: rows.length });
      broadcast('data:sync:done', { type: 'groups', count: rows.length });
      return json(res, 200, { ok: true, count: rows.length, rows });
    }
    if (req.method === 'POST' && p === '/api/data/sync/chats') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const result = await directory.syncChats(s.client, {
        limitMessages: Math.min(500, Math.max(1, Number(x.limitMessages || 50))),
        types: x.types || 'all',
        onMessage: async (message, chat) => collector.ingest(message, chat)
      });
      audit.append('chat_history_synced', { accountId: s.id, ...result });
      broadcast('data:sync:done', { type: 'chats', ...result });
      return json(res, 200, { ok: true, ...result });
    }
    if (req.method === 'POST' && p === '/api/data/validate/numbers') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const rows = await directory.validateNumbers(s.client, x.numbers || [], {
        includeProfilePicture: x.includeProfilePicture !== false
      });
      return json(res, 200, { ok: true, rows });
    }
    if (req.method === 'POST' && p === '/api/data/search') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const rows = await s.client.searchMessages(String(x.query || ''), {
        limit: Math.min(500, Math.max(1, Number(x.limit || 50))),
        ...(x.chatId ? { chatId: String(x.chatId) } : {})
      });
      return json(res, 200, { ok: true, rows });
    }
    if (req.method === 'POST' && p === '/api/data/group-intelligence') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const metrics = {
        addedBy: x.metrics?.addedBy !== false,
        groups: x.metrics?.groups !== false,
        messages: x.metrics?.messages !== false,
        reactions: x.metrics?.reactions !== false
      };
      const result = await groupIntelligence.analyze(s.client, x.number, {
        ...x, metrics, limitMessages: Math.min(5000, Math.max(1, Number(x.limitMessages || 200)))
      });
      audit.append('group_intelligence_analyzed', {
        accountId: s.id, targetPhone: result.targetPhone, metrics,
        groupsEncountered: result.groupsEncountered, addedTimes: result.addedTimes,
        messageCount: result.messageCount, reactionCount: result.reactionCount
      });
      broadcast('group:intelligence:done', { accountId: s.id, ...result });
      return json(res, 200, { ok: true, result });
    }
    if (req.method === 'POST' && p === '/api/data/channel/subscribers') {
      const x = await parseBody(req); const s = await requireReady(x.accountId);
      const rows = await directory.channelSubscribers(s.client, x.channelId, {
        limit: Math.min(1000, Math.max(1, Number(x.limit || 100))),
        includeProfiles: !!x.includeProfiles
      });
      return json(res, 200, { ok: true, rows });
    }
    if (req.method === 'POST' && p === '/api/data/export') {
      const x = await parseBody(req);
      const format = String(x.format || 'json').toLowerCase();
      const source = String(x.source || 'messages');
      const rows = source === 'contacts' ? collector.listContacts()
        : source === 'groups' ? collector.listGroups()
        : source === 'profiles' ? collector.listProfiles()
        : source === 'chats' ? collector.listChats()
        : collector.listMessages(Math.min(5000, Number(x.limit || 5000)));
      if (!['json', 'csv', 'xls', 'excel', 'html', 'xml', 'jsonl', 'rss', 'txt'].includes(format)) {
        throw new Error('Unsupported export format');
      }
      const { exportData } = require('./11-exporter');
      const ext = format === 'excel' ? 'xls' : format;
      const file = path.join(ROOT, 'exports');
      fs.mkdirSync(file, { recursive: true });
      const output = path.join(file, Date.now() + '-whatsapp-' + safeFileName(source) + '.' + ext);
      const result = exportData(rows, format, output, 'WhatsApp ' + source + ' export');
      audit.append('data_exported', { source, format, count: rows.length, file: output });
      return json(res, 200, { ok: true, ...result, path: output });
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    audit.append('server_error', { path: p, error: String(e.message || e) });
    return json(res, 400, { ok: false, error: String(e.message || e) });
  }
}

const port = Math.max(1, Number(process.env.PORT || 8787));
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer(route);

server.listen(port, host, () => {
  console.log('WhatsApp Scrapper Web Server listening on http://' + host + ':' + port);
  console.log('Data directory: ' + ROOT);
  setTimeout(async () => {
    for (const account of registry.list().filter(x => x.enabled !== false)) {
      if (sessions.has(account.id)) continue;
      try {
        await createSession(account);
        console.log('Restored account: ' + account.id);
      } catch (e) {
        audit.append('account_restore_error', { accountId: account.id, error: String(e.message || e) });
        broadcast('session:error', { id: account.id, error: String(e.message || e) });
      }
    }
  }, 1000);
});

async function shutdown() {
  for (const s of [...sessions.values()]) {
    try { await s.client.destroy(); } catch {}
  }
  sessions.clear();
  for (const res of listeners) { try { res.end(); } catch {} }
  listeners.clear();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
