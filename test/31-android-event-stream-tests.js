'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'termux-service.sh'), 'utf8');
const activity = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'galaxyuniversity', 'whatsappscrapper', 'MainActivity.kt'), 'utf8');

assert.match(html, /window\.getActiveBackendUrl\(\)\+eventStreamPath/,
  'bundled file:// UI must send SSE to the active HTTP backend, not file:///events');
assert.match(html, /new EventSource\(eventStreamUrl\)/,
  'SSE must use the resolved backend URL');
assert.match(html, /eventStreamPath='\/events\?token='/,
  'SSE must retain API-token authorization');
assert.match(server, /if \(req\.method === 'GET' && p === '\/events'\)/,
  'server must expose the authenticated event stream');
assert.match(server, /if \(session\.lastQr\)/,
  'server must replay a pending QR to newly connected clients');
assert.match(service, /WA_ALLOW_FILE_ORIGIN=\"\$\{WA_ALLOW_FILE_ORIGIN:-1\}\"/,
  'Termux supervisor must allow the bundled Android file origin');
assert.match(service, /restart\\) stop && stop_orphan_server && start \\;/,
  'restart must not exit early and must handle an unmanaged local server');
assert.match(activity, /exec bash scripts\\/termux-service\\.sh restart/,
  'APK start action must restart the service to apply CORS settings');
console.log('PASS Android bundled SSE URL, token, QR replay, Termux CORS, and restart checks');
