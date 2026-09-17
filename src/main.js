const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const sessions = new Map();
const dataDir = path.join(app.getPath('userData'), 'data');
const contactsFile = path.join(dataDir, 'contacts.json');
const settingsFile = path.join(dataDir, 'settings.json');
fs.mkdirSync(dataDir, { recursive: true });

function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function contacts() { return readJson(contactsFile, []); }
function settings() { return readJson(settingsFile, { minDelay: 10, maxDelay: 30, perAccountLimit: 100, headless: false, parallel: false }); }

let win;
function createWindow() {
  win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1100, minHeight: 700, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function emit(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function randomDelay(min, max) { return Math.floor((Math.random() * (max - min + 1) + min) * 1000); }

async function createSession(id, headless = false) {
  if (sessions.has(id)) return { ok: true, id };
  const client = new Client({ authStrategy: new LocalAuth({ clientId: id }), puppeteer: { headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] } });
  const state = { id, client, status: 'initializing', sent: 0, paused: false, stopped: false };
  sessions.set(id, state);
  client.on('qr', async qr => emit('session:qr', { id, qr: await qrcode.toDataURL(qr) }));
  client.on('authenticated', () => { state.status = 'authenticated'; emit('session:status', { id, status: state.status }); });
  client.on('ready', () => { state.status = 'ready'; emit('session:status', { id, status: state.status }); });
  client.on('disconnected', reason => { state.status = 'disconnected'; emit('session:status', { id, status: state.status, reason }); sessions.delete(id); });
  client.on('auth_failure', reason => { state.status = 'auth_failure'; emit('session:status', { id, status: state.status, reason }); });
  await client.initialize();
  return { ok: true, id };
}

async function sendCampaign({ accountId, template, mediaPath, minDelay, maxDelay, limit }) {
  const state = sessions.get(accountId);
  if (!state || state.status !== 'ready') throw new Error('Account is not ready');
  const all = contacts().filter(c => c.consent === true && c.status !== 'sent' && c.phone);
  const batch = all.slice(0, Math.max(0, Number(limit) || 100));
  state.paused = false; state.stopped = false;
  for (const c of batch) {
    while (state.paused && !state.stopped) await new Promise(r => setTimeout(r, 500));
    if (state.stopped) break;
    try {
      const number = String(c.phone).replace(/\D/g, '');
      const chatId = `${number}@c.us`;
      const body = String(template || '').replace(/\{name\}/gi, c.name || '').replace(/\{phone\}/gi, c.phone || '');
      if (mediaPath && fs.existsSync(mediaPath)) await state.client.sendMessage(chatId, MessageMedia.fromFilePath(mediaPath), { caption: body });
      else await state.client.sendMessage(chatId, body);
      c.status = 'sent'; c.lastSentAt = new Date().toISOString(); state.sent++;
      writeJson(contactsFile, contacts());
      emit('campaign:progress', { accountId, phone: c.phone, status: 'sent', sent: state.sent, total: batch.length });
    } catch (error) {
      c.status = 'failed'; c.error = String(error.message || error); writeJson(contactsFile, contacts());
      emit('campaign:progress', { accountId, phone: c.phone, status: 'failed', error: c.error, sent: state.sent, total: batch.length });
    }
    await new Promise(r => setTimeout(r, randomDelay(Number(minDelay) || 10, Number(maxDelay) || 30)));
  }
  emit('campaign:done', { accountId, sent: state.sent });
}

ipcMain.handle('settings:get', () => settings());
ipcMain.handle('settings:set', (_, value) => { const s = { ...settings(), ...value }; writeJson(settingsFile, s); return s; });
ipcMain.handle('contacts:get', () => contacts());
ipcMain.handle('contacts:set', (_, value) => { writeJson(contactsFile, value); return value; });
ipcMain.handle('contacts:import', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'CSV/JSON', extensions: ['csv', 'json'] }] });
  if (result.canceled) return [];
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  let rows = [];
  if (result.filePaths[0].toLowerCase().endsWith('.json')) rows = JSON.parse(raw);
  else rows = raw.split(/\r?\n/).filter(Boolean).slice(1).map(line => { const [phone, name = ''] = line.split(','); return { phone: phone.trim(), name: name.trim(), consent: false, status: 'pending' }; });
  const merged = [...contacts(), ...rows].filter((v, i, a) => v.phone && a.findIndex(x => x.phone === v.phone) === i);
  writeJson(contactsFile, merged); return merged;
});
ipcMain.handle('session:create', (_, { id, headless }) => createSession(id, !!headless));
ipcMain.handle('session:list', () => [...sessions.values()].map(s => ({ id: s.id, status: s.status, sent: s.sent })));
ipcMain.handle('campaign:pause', (_, id) => { const s = sessions.get(id); if (s) s.paused = true; });
ipcMain.handle('campaign:resume', (_, id) => { const s = sessions.get(id); if (s) s.paused = false; });
ipcMain.handle('campaign:stop', (_, id) => { const s = sessions.get(id); if (s) { s.stopped = true; s.paused = false; } });
ipcMain.handle('campaign:start', (_, payload) => { sendCampaign(payload).catch(e => emit('campaign:error', { error: e.message })); return { ok: true }; });
ipcMain.handle('media:pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','webp','mp3','wav','mp4','mov'] }] }); return r.canceled ? null : r.filePaths[0]; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
