'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
assert.equal(pkg.version,'5.6.0');
assert.ok(pkg.scripts['test:all'].includes('test:capabilities'));

const foundation=fs.readFileSync(path.join(__dirname,'..','src','30-capability-foundation.js'),'utf8');
assert.ok(foundation.includes('timeoutMs'));
assert.ok(foundation.includes('_assertPolicy'));
assert.ok(foundation.includes('INPUT_REQUIRED'));
assert.ok(foundation.includes('LOCAL_DISABLED'));
assert.ok(foundation.includes('EXTERNAL_DISABLED'));

const hub=fs.readFileSync(path.join(__dirname,'..','src','29-ai-provider-hub.js'),'utf8');
assert.ok(hub.includes('AbortController'));
assert.ok(hub.includes('normalizeBaseUrl'));
assert.ok(hub.includes('presets()'));
assert.ok(hub.includes('Provider base URL must not contain credentials'));

const server=fs.readFileSync(path.join(__dirname,'..','src','server.js'),'utf8');
assert.ok(server.includes('WA_API_TOKEN'));
assert.ok(server.includes('API authorization required'));
assert.ok(server.includes('WA_ALLOWED_ORIGINS'));
assert.ok(server.includes("X-API-Key"));
assert.ok(server.includes("X-Frame-Options"));

const web=fs.readFileSync(path.join(__dirname,'..','src','web','index.html'),'utf8');
assert.ok(web.includes('/api/security/token'));
assert.ok(web.includes('X-API-Key'));
assert.ok(web.includes('/events?token='));

console.log('Production hardening tests passed');
