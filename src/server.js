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
const { GroupLinkWorkspace } = require('./14-group-link-workspace');
const { PublicChannelSearch } = require('./27-public-channel-search');
const { MultiAccountOrchestrator } = require('./15-multi-account-orchestrator');
const { ContactDirectory, normPhone } = require('./16-contact-directory');
const { sendCloud } = require('./17-cloud-api');
const { SecretStore } = require('./18-secret-store');
const { TelegramAdapter } = require('./28-telegram-adapter');
const { AIProviderHub } = require('./29-ai-provider-hub');

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
const groupWorkspace = new GroupLinkWorkspace(path.join(dataDir, 'group-workspace-latest.json'));
const publicChannelSearch = new PublicChannelSearch();
const groupJobs = new Map();
const accountOrchestrator = new MultiAccountOrchestrator(path.join(dataDir, 'account-schedules.json'));
const contactDirectory = new ContactDirectory(path.join(dataDir, 'contacts.json'));
const secretStore = new SecretStore(path.join(dataDir, 'secrets.json'));
const telegram = new TelegramAdapter({ dataDir: path.join(dataDir, 'telegram'), audit });
const aiHub = new AIProviderHub({ dataDir: path.join(dataDir, 'ai'), masterKey: process.env.AI_MASTER_KEY || process.env.WA_MASTER_KEY });
const { createPlatform } = require('./26-platform-api');
const platform = createPlatform(dataDir);

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
    qr: !!s.lastQr,
    transport: s.transport || 'web_qr',
    phone: s.phone || null,
    pairingCode: s.pairingCode || null,
    cloud: s.transport === 'cloud_api' ? { phoneNumberId:s.phoneNumberId, version:s.cloudVersion } : null
  };
}

async function createSession(input = {}) {
  const transport=String(input.transport||'web_qr');
  if(transport==='cloud_api') return createCloudSession(input);
  if(!['web_qr','web_pairing'].includes(transport)) throw new Error('Unsupported transport');
  const id = normalizeId(input.id);
  if (!id) throw new Error('Account ID required');
  const existing = sessions.get(id);
  if (existing) return { ok: true, id, existing: true, session: sessionPublic(existing) };
  const cap=accountOrchestrator.capacity(sessions.size);
  if(!cap.canCreate) throw new Error('Account capacity reached: '+cap.max+' live accounts');

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
    id, client, browser, headless, manager, status: 'initializing', transport, phone: transport==='web_pairing'?normPhone(input.phone):null, pairingCode:null,
    sent: 0, consecutiveFailures: 0, paused: false, stopped: false,
    lastQr: null, createdAt: new Date().toISOString()
  };
  sessions.set(id, s);
  registry.upsert({ id, browser, headless, enabled: true, transport, phone: s.phone || null });

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
    if(transport==='web_pairing'){
      if(!/^\d{7,15}$/.test(s.phone||'')) throw new Error('A valid international phone number is required for pairing code');
      if(typeof client.requestPairingCode!=='function') throw new Error('This whatsapp-web.js build does not expose pairing-code support');
      s.pairingCode=await client.requestPairingCode(s.phone);
      s.status='pairing_code';
      broadcast('session:pairing', {id,phone:s.phone,code:s.pairingCode});
    }
    audit.append('account_initialize_started', { accountId: id, browser, transport });
    return { ok: true, id, session: sessionPublic(s) };
  } catch (e) {
    sessions.delete(id);
    try { await client.destroy(); } catch {}
    audit.append('account_initialize_error', { accountId: id, error: String(e.message || e) });
    throw e;
  }
}

async function createCloudSession(input={}) {
  const id=normalizeId(input.id); if(!id) throw new Error('Account ID required');
  if(sessions.has(id)) return {ok:true,id,existing:true,session:sessionPublic(sessions.get(id))};
  const cap=accountOrchestrator.capacity(sessions.size); if(!cap.canCreate) throw new Error('Account capacity reached: '+cap.max+' live accounts');
  const phoneNumberId=String(input.phoneNumberId||''); if(!/^\d+$/.test(phoneNumberId)) throw new Error('Cloud API phone number ID required');
  const token=String(input.token||secretStore.get(id)||''); if(!token) throw new Error('Cloud API token required (or set WA_MASTER_KEY and configure the account once)');
  const s={id,client:null,browser:null,headless:true,manager:null,status:'ready',transport:'cloud_api',phoneNumberId,cloudVersion:String(input.version||'v23.0'),cloudToken:token,createdAt:new Date().toISOString(),sent:0,consecutiveFailures:0};
  sessions.set(id,s);
  secretStore.set(id,token);
  registry.upsert({id,enabled:true,transport:'cloud_api',phoneNumberId,cloudVersion:s.cloudVersion,tokenConfigured:true});
  audit.append('cloud_account_ready',{accountId:id,phoneNumberId});
  broadcast('session:status',sessionPublic(s));
  return {ok:true,id,session:sessionPublic(s)};
}
async function sendCloudCampaign(payload={}) {
  const s=sessions.get(normalizeId(payload.accountId));
  if(!s||s.transport!=='cloud_api'||s.status!=='ready') throw new Error('Cloud API account is not ready');
  const text=String(payload.template||'').trim(); if(!text) throw new Error('Campaign message is empty');
  const gender=String(payload.gender||'all').toLowerCase();
  const eligible=contactDirectory.filter({gender}).filter(x=>x.consent===true&&x.optOut!==true&&x.status!=='sent'&&x.status!=='suppressed')
    .slice(0,Math.min(10000,Math.max(1,Number(payload.limit||100))));
  const results=[]; const delay=Math.min(3600,Math.max(0,Number(payload.intervalSeconds??10)));
  for(const contact of eligible){
    try{
      const body=text.replace(/\{name\}/gi,contact.name||'').replace(/\{phone\}/gi,contact.phone||'');
      const data=await sendCloud({token:s.cloudToken,phoneNumberId:s.phoneNumberId,to:contact.phone,text:body,version:s.cloudVersion});
      s.sent++; results.push({phone:contact.phone,name:contact.name,status:'sent',response:data});
      audit.append('cloud_message_sent',{accountId:s.id,phone:contact.phone});
    }catch(e){results.push({phone:contact.phone,name:contact.name,status:'failed',error:String(e.message||e)});audit.append('cloud_message_failed',{accountId:s.id,phone:contact.phone,error:String(e.message||e)});}
    if(delay>0) await sleep(delay*1000);
  }
  return {ok:true,total:eligible.length,sent:results.filter(x=>x.status==='sent').length,failed:results.filter(x=>x.status==='failed').length,results};
}
async function runAccountSchedule(row){
  try{
    if(row.action==='start') await createSession(row.payload||{id:row.accountId});
    else if(row.action==='cloud_send') await sendCloudCampaign({...row.payload,accountId:row.accountId});
    else if(row.action==='logout') await logoutSession(row.accountId,false);
    accountOrchestrator.complete(row.id,'completed'); audit.append('account_schedule_completed',{scheduleId:row.id,accountId:row.accountId});
  }catch(e){accountOrchestrator.complete(row.id,'failed',e.message);audit.append('account_schedule_failed',{scheduleId:row.id,accountId:row.accountId,error:String(e.message||e)});}
}
setInterval(()=>{for(const row of accountOrchestrator.due()) runAccountSchedule(row);},1000);

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
    secretStore.remove(key);
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

async function startGroupMessageJob(payload = {}) {
  const accountId = String(payload.accountId || '');
  const s = await requireReady(accountId);
  const snapshot = groupWorkspace.last();
  if (!snapshot.rows?.length) throw new Error('Extract a group or channel first');
  const text = String(payload.message || '').trim();
  if (!text) throw new Error('Message is empty');
  const intervalSeconds = Math.min(3600, Math.max(0, Number(payload.intervalSeconds ?? 10)));
  const all = await state.readContacts();
  const eligible = policy.filterEligible(all);
  const consented = new Map(eligible.map(x => [policy.normalizePhone(x.contact.phone), x.contact]));
  const targets = snapshot.rows.map((row, index) => ({
    ...row, index, phone: policy.normalizePhone(row.phone),
    consented: !!consented.get(policy.normalizePhone(row.phone))
  }));
  const jobId = 'group-' + Date.now().toString(36);
  const job = {
    id: jobId, accountId, source: snapshot.source, message: text,
    intervalSeconds, total: targets.length, sent: 0, skipped: 0, failed: 0,
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null
  };
  groupJobs.set(jobId, job);
  audit.append('group_message_job_started', {
    jobId, accountId, source: snapshot.source, total: targets.length,
    eligible: targets.filter(x => x.consented).length, intervalSeconds
  });
  broadcast('group:job:status', job);

  (async () => {
    for (const target of targets) {
      if (groupJobs.get(jobId)?.status === 'stopped') break;
      const current = groupJobs.get(jobId);
      if (!target.phone || !target.consented) {
        current.skipped++;
        broadcast('group:job:progress', current);
        continue;
      }
      try {
        const contact = consented.get(target.phone);
        const body = text.replace(/\{name\}/gi, contact?.name || target.name || '')
          .replace(/\{phone\}/gi, target.phone);
        const sent = await s.client.sendMessage(target.phone + '@c.us', body);
        delivery.create({
          id: sent?.id?._serialized || ('group-' + jobId + '-' + target.index),
          accountId, phone: target.phone, contactIndex: null
        });
        current.sent++;
        audit.append('group_message_sent', { jobId, accountId, phone: target.phone });
      } catch (e) {
        current.failed++;
        audit.append('group_message_failed', { jobId, accountId, phone: target.phone, error: String(e.message || e) });
      }
      broadcast('group:job:progress', current);
      if (current.status === 'stopped') break;
      if (intervalSeconds > 0) await sleep(intervalSeconds * 1000);
    }
    const final = groupJobs.get(jobId);
    if (final && final.status !== 'stopped') final.status = 'completed';
    if (final) {
      final.finishedAt = new Date().toISOString();
      audit.append('group_message_job_completed', {
        jobId, accountId, sent: final.sent, skipped: final.skipped, failed: final.failed,
        status: final.status
      });
      broadcast('group:job:done', final);
    }
  })().catch(e => {
    const failed = groupJobs.get(jobId);
    if (failed) {
      failed.status = 'failed';
      failed.error = String(e.message || e);
      failed.finishedAt = new Date().toISOString();
      broadcast('group:job:done', failed);
    }
    audit.append('group_message_job_error', { jobId, accountId, error: String(e.message || e) });
  });

  return { ok: true, job };
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
    if (req.method === 'GET' && p === '/api/ai/models') return json(res, 200, { ok:true, models: aiHub.models(), count: aiHub.models().length });
    if (req.method === 'GET' && p === '/api/ai/presets') return json(res, 200, { ok:true, presets: aiHub.presets() });
    if (req.method === 'GET' && p === '/api/ai/providers') return json(res, 200, { ok:true, providers: aiHub.providers() });
    if (req.method === 'POST' && p === '/api/ai/providers') { const x=await parseBody(req); return json(res,200,{ok:true,provider:aiHub.upsert(x)}); }
    if (req.method === 'DELETE' && p === '/api/ai/providers') { return json(res,200,aiHub.remove(url.searchParams.get('id'))); }
    if (req.method === 'POST' && p === '/api/ai/providers/discover') { const x=await parseBody(req); return json(res,200,{ok:true,models:await aiHub.discover(x.id)}); }
    if (req.method === 'POST' && p === '/api/ai/chat') { const x=await parseBody(req); return json(res,200,{ok:true,result:await aiHub.chat(x.id,x)}); }
    if (req.method === 'POST' && p === '/api/ai/compare') { const x=await parseBody(req); return json(res,200,{ok:true,results:await aiHub.compare(x)}); }

    if (req.method === 'GET' && p === '/api/telegram/capabilities') return json(res, 200, telegram.capabilities());
    if (req.method === 'GET' && p === '/api/telegram/accounts') return json(res, 200, telegram.listAccounts());
    if (req.method === 'GET' && p === '/api/telegram/auth/status') return json(res, 200, telegram.authStatus(url.searchParams.get('id')));
    if (req.method === 'GET' && p === '/api/telegram/me') return json(res, 200, await telegram.me(url.searchParams.get('id')));
    if (req.method === 'GET' && p === '/api/telegram/dialogs') return json(res, 200, await telegram.dialogs(url.searchParams.get('id'), url.searchParams.get('limit')));
    if (req.method === 'POST' && p === '/api/telegram/auth/start') {
      const x = await parseBody(req);
      return json(res, 200, await telegram.startLogin(x));
    }
    if (req.method === 'POST' && p === '/api/telegram/auth/code') {
      const x = await parseBody(req);
      return json(res, 200, telegram.submitCode(x.id, x.code));
    }
    if (req.method === 'POST' && p === '/api/telegram/auth/password') {
      const x = await parseBody(req);
      return json(res, 200, telegram.submitPassword(x.id, x.password));
    }
    if (req.method === 'POST' && p === '/api/telegram/auth/restore') {
      const x = await parseBody(req);
      return json(res, 200, await telegram.restore(x.id, x.apiId, x.apiHash));
    }
    if (req.method === 'POST' && p === '/api/telegram/disconnect') {
      const x = await parseBody(req);
      return json(res, 200, await telegram.disconnect(x.id, !!x.forget));
    }
    if (req.method === 'POST' && p === '/api/telegram/public/search') {
      const x = await parseBody(req);
      const rows = await telegram.searchPublic(x.id, x.query, x.limit);
      audit.append('telegram_public_search', { accountId: String(x.id), query: String(x.query || '').slice(0, 200), count: rows.length });
      return json(res, 200, { ok: true, rows, count: rows.length });
    }
    if (req.method === 'POST' && p === '/api/telegram/resolve') {
      const x = await parseBody(req);
      return json(res, 200, { ok: true, entity: await telegram.resolve(x.id, x.target) });
    }
    if (req.method === 'POST' && p === '/api/telegram/messages') {
      const x = await parseBody(req);
      const rows = await telegram.messages(x.id, x.target, x.options || {});
      return json(res, 200, { ok: true, rows, count: rows.length });
    }
    if (req.method === 'POST' && p === '/api/telegram/public/members') {
      const x = await parseBody(req);
      const rows = await telegram.publicMembers(x.id, x.target, x.limit);
      audit.append('telegram_public_members_listed', { accountId: String(x.id), target: String(x.target || ''), count: rows.length });
      return json(res, 200, { ok: true, rows, count: rows.length });
    }
    if (req.method === 'POST' && p === '/api/telegram/media/download') {
      const x = await parseBody(req);
      return json(res, 200, await telegram.downloadMedia(x.id, x.target, x.messageId, path.join(ROOT, 'exports', 'telegram-media')));
    }
    if (req.method === 'POST' && p === '/api/telegram/export') {
      const x = await parseBody(req);
      return json(res, 200, await telegram.exportRows(x.rows || [], x.format || 'json', path.join(ROOT, 'exports', 'telegram-' + Date.now() + '.' + (x.format === 'excel' ? 'xls' : String(x.format || 'json')))));
    }
    if (req.method === 'POST' && p === '/api/telegram/send') {
      const x = await parseBody(req);
      const result = await telegram.sendText(x.id, x.target, x.text);
      audit.append('telegram_message_sent', { accountId: String(x.id), target: String(x.target || '') });
      return json(res, 200, { ok: true, result });
    }

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
      return json(res, 200, registry.list().map(a=>({...a,live:!!sessions.get(a.id),session:sessions.get(a.id)?sessionPublic(sessions.get(a.id)):null})));
    }
    if (req.method === 'GET' && p === '/api/accounts/capacity') return json(res,200,accountOrchestrator.capacity(sessions.size));
    if (req.method === 'GET' && p === '/api/accounts/schedules') return json(res,200,accountOrchestrator.listSchedules());
    if (req.method === 'GET' && p === '/api/platform/contacts') return json(res,200,platform.contacts.all());
    if (req.method === 'GET' && p === '/api/platform/segments') return json(res,200,platform.store.list('segments'));
    if (req.method === 'GET' && p === '/api/platform/tasks') return json(res,200,platform.store.list('tasks'));
    if (req.method === 'GET' && p === '/api/platform/leads') return json(res,200,platform.store.list('leads'));
    if (req.method === 'GET' && p === '/api/platform/templates') return json(res,200,platform.store.list('templates'));
    if (req.method === 'GET' && p === '/api/platform/automations') return json(res,200,platform.store.list('automations'));
    if (req.method === 'GET' && p === '/api/platform/webhooks') return json(res,200,platform.store.list('webhooks'));
    if (req.method === 'GET' && p === '/api/platform/activity') return json(res,200,platform.store.list('activity').slice(-500));
    if (req.method === 'GET' && p === '/api/platform/customer360') return json(res,200,platform.crm.customer360(url.searchParams.get('contactId')));
    if (req.method === 'POST' && p === '/api/platform/contact') return json(res,200,{ok:true,contact:platform.contacts.upsert(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/contact/merge') { const x=await parseBody(req); return json(res,200,{ok:true,contact:platform.contacts.merge(x.primaryId,x.duplicateIds||[])}); }
    if (req.method === 'POST' && p === '/api/platform/segment') { const x=await parseBody(req); return json(res,200,{ok:true,segment:platform.contacts.segment(x.name,x.query||{})}); }
    if (req.method === 'POST' && p === '/api/platform/task') return json(res,200,{ok:true,task:platform.crm.task(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/task/update') { const x=await parseBody(req); return json(res,200,{ok:true,task:platform.crm.updateTask(x.id,x.patch||{})}); }
    if (req.method === 'POST' && p === '/api/platform/lead') return json(res,200,{ok:true,lead:platform.crm.pipeline(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/template') return json(res,200,{ok:true,template:platform.templates.create(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/template/version') { const x=await parseBody(req); return json(res,200,{ok:true,template:platform.templates.version(x.id,x.body)}); }
    if (req.method === 'POST' && p === '/api/platform/automation') return json(res,200,{ok:true,automation:platform.automations.create(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/webhook') return json(res,200,{ok:true,webhook:platform.webhooks.create(await parseBody(req))});
    if (req.method === 'POST' && p === '/api/platform/backup') return json(res,200,{ok:true,file:platform.backups.create()});
    if (req.method === 'POST' && p === '/api/platform/search') { const x=await parseBody(req); return json(res,200,platform.contacts.filter({search:x.q||'',gender:x.gender||'all',tag:x.tag||null})); }

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
    if (req.method === 'POST' && p === '/api/accounts/schedule') { const x=await parseBody(req); if(!x.accountId||!x.runAt) throw new Error('accountId and runAt required'); const row=accountOrchestrator.schedule(x); audit.append('account_schedule_created',{scheduleId:row.id,accountId:row.accountId,runAt:row.runAt}); return json(res,200,{ok:true,schedule:row}); }
    if (req.method === 'POST' && p === '/api/accounts/schedule/cancel') { const x=await parseBody(req); const row=accountOrchestrator.cancel(x.id); if(!row) throw new Error('Schedule not found'); return json(res,200,{ok:true,schedule:row}); }
    if (req.method === 'POST' && p === '/api/accounts/cloud/send') return json(res,200,await sendCloudCampaign(await parseBody(req)));
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
    if (req.method === 'POST' && p === '/api/contacts/import-file') { const x=await parseBody(req); if(typeof x.raw!=='string') throw new Error('raw contact file required'); const result=contactDirectory.import(x.raw,x.format); audit.append('contacts_imported_file',{format:x.format,count:result.imported}); return json(res,200,{ok:true,...result}); }
    if (req.method === 'GET' && p === '/api/contacts/filter') { return json(res,200,contactDirectory.filter({gender:url.searchParams.get('gender')||'all'})); }
    if (req.method === 'POST' && p === '/api/contacts/upsert') { const x=await parseBody(req); const row=contactDirectory.upsert(x); return json(res,200,{ok:true,contact:row}); }
    if (req.method === 'POST' && p === '/api/contacts/delete') { const x=await parseBody(req); const removed=contactDirectory.remove(x.phone); return json(res,200,{ok:true,removed}); }
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
    if (req.method === 'POST' && p === '/api/channels/public/search') {
      const x = await parseBody(req);
      const s = await requireReady(x.accountId);
      const result = await publicChannelSearch.search(s.client, {
        searchText: x.searchText,
        countryCodes: x.countryCodes,
        skipSubscribedNewsletters: x.skipSubscribedNewsletters,
        view: x.view,
        limit: x.limit
      });
      audit.append('public_channels_searched', {
        accountId: s.id,
        searchText: String(x.searchText || '').slice(0, 200),
        countryCodes: Array.isArray(x.countryCodes) ? x.countryCodes : [],
        count: result.count
      });
      return json(res, 200, { ok: true, ...result });
    }
    if (req.method === 'POST' && p === '/api/group-workspace/extract') {
      const x = await parseBody(req);
      const s = await requireReady(x.accountId);
      const result = await groupWorkspace.extract(s.client, x.url, { includeProfiles: !!x.includeProfiles });
      audit.append('group_workspace_extracted', {
        accountId: s.id, type: result.source?.type, title: result.source?.title, count: result.total
      });
      broadcast('group:extracted', { accountId: s.id, ...result });
      return json(res, 200, { ok: true, ...result });
    }
    if (req.method === 'GET' && p === '/api/group-workspace/latest') {
      return json(res, 200, groupWorkspace.last());
    }
    if (req.method === 'POST' && p === '/api/group-workspace/send') {
      return json(res, 200, await startGroupMessageJob(await parseBody(req)));
    }
    if (req.method === 'GET' && p === '/api/group-workspace/jobs') {
      return json(res, 200, [...groupJobs.values()]);
    }
    if (req.method === 'POST' && p === '/api/group-workspace/stop') {
      const x = await parseBody(req);
      const job = groupJobs.get(String(x.jobId || ''));
      if (!job) throw new Error('Group message job not found');
      job.status = 'stopped';
      job.finishedAt = new Date().toISOString();
      audit.append('group_message_job_stopped', { jobId: job.id, accountId: job.accountId });
      broadcast('group:job:done', job);
      return json(res, 200, { ok: true, job });
    }
    if (req.method === 'POST' && p === '/api/group-workspace/export') {
      const x = await parseBody(req);
      const format = String(x.format || 'csv').toLowerCase();
      const allowed = ['json','csv','xls','excel','html','xml','jsonl','rss','txt'];
      if (!allowed.includes(format)) throw new Error('Unsupported export format');
      const rows = groupWorkspace.last().rows || [];
      const { exportData } = require('./11-exporter');
      const ext = format === 'excel' ? 'xls' : format;
      const dir = path.join(ROOT, 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const output = path.join(dir, Date.now() + '-group-members.' + ext);
      const result = exportData(rows, format, output, 'WhatsApp Group/Channel Members');
      audit.append('group_workspace_exported', { format, count: rows.length, file: output });
      return json(res, 200, { ok: true, ...result, source: groupWorkspace.last().source });
    }

    if (req.method === 'POST' && p === '/api/groups/create') {
      const x=await parseBody(req); const s=await requireReady(x.accountId); const name=String(x.name||'').trim(); if(!name) throw new Error('Group name required');
      const contacts=(Array.isArray(x.phones)?x.phones:[]).map(normPhone).filter(Boolean);
      const all=contactDirectory.read().filter(c=>c.consent===true&&c.optOut!==true&&c.status!=='suppressed');
      const allowed=new Set(all.map(c=>normPhone(c.phone))); const participants=contacts.filter(p=>allowed.has(p)).map(p=>p+'@c.us');
      if(!participants.length) throw new Error('No consented participants selected');
      if(typeof s.client.createGroup!=='function') throw new Error('Group creation is not supported by this WhatsApp runtime');
      const group=await s.client.createGroup(name,participants); audit.append('group_created',{accountId:s.id,name,participants:participants.length});
      return json(res,200,{ok:true,group});
    }
    if (req.method === 'POST' && p === '/api/groups/add-consented') {
      const x=await parseBody(req); const s=await requireReady(x.accountId); const groupId=String(x.groupId||''); if(!groupId) throw new Error('groupId required');
      const allowed=new Set(contactDirectory.read().filter(c=>c.consent===true&&c.optOut!==true&&c.status!=='suppressed').map(c=>normPhone(c.phone)));
      const participants=(Array.isArray(x.phones)?x.phones:[]).map(normPhone).filter(p=>allowed.has(p)).map(p=>p+'@c.us');
      const chat=await s.client.getChatById(groupId); if(!chat||typeof chat.addParticipants!=='function') throw new Error('Group participant management unavailable');
      const result=await chat.addParticipants(participants); audit.append('group_consented_participants_added',{accountId:s.id,groupId,participants:participants.length}); return json(res,200,{ok:true,result});
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
  try { await telegram.shutdown(); } catch {}
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
