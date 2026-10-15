'use strict';

const fs = require('fs');
const path = require('path');

function str(v) { return String(v == null ? '' : v).trim(); }
function phone(v) { return str(v).replace(/\D/g, ''); }
function recordKey(row, index) { return str(row && (row.id || row.phone || row.number || row.email)) || 'row-' + index; }
function fileCheck(file) {
  try { const s = fs.statSync(file); return { exists:true, directory:s.isDirectory(), size:s.size }; }
  catch { return { exists:false, directory:false, size:0 }; }
}
function isOptedOut(row) { return !!(row && (row.optOut === true || row.optedOut === true || row.status === 'opted_out' || row.status === 'suppressed')); }

class ControlCenter {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.dataDir = path.resolve(options.dataDir || path.join(this.root, '.data'));
    this.startedAt = new Date().toISOString();
    this.aiEnabled = options.aiEnabled === true;
  }
  diagnostics() {
    const checks = [];
    const add = (id, status, detail, critical = false) => checks.push({ id, status, detail, critical });
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    add('node-version', nodeMajor >= 18 ? 'ok' : 'warning', 'Node.js ' + process.versions.node + (nodeMajor >= 18 ? ' is supported by this control layer.' : ' is below the recommended Node.js 18 baseline.'), nodeMajor < 18);
    add('data-directory', fileCheck(this.dataDir).directory ? 'ok' : 'warning', fileCheck(this.dataDir).directory ? 'Data directory exists.' : 'Data directory does not exist yet; it may be created during startup.');
    try {
      fs.mkdirSync(this.dataDir, { recursive:true });
      const probe = path.join(this.dataDir, '.write-probe-' + process.pid);
      fs.writeFileSync(probe, 'ok', { mode:0o600 });
      fs.unlinkSync(probe);
      add('data-write', 'ok', 'Data directory is writable.');
    } catch (error) { add('data-write', 'error', 'Data directory is not writable: ' + String(error.code || error.message), true); }
    let xlsxAvailable = false;
    try { require.resolve('xlsx'); xlsxAvailable = true; } catch {}
    add('xlsx-module', xlsxAvailable ? 'ok' : 'warning', xlsxAvailable ? 'xlsx module resolves.' : 'xlsx is declared by the project but is not resolvable in this runtime; spreadsheet routes may fail.');
    add('ai-mode', this.aiEnabled ? 'configured' : 'optional', this.aiEnabled ? 'AI mode is enabled by the caller.' : 'No AI provider is required for deterministic features.');
    const critical = checks.filter(x => x.critical && x.status !== 'ok').length;
    const errors = checks.filter(x => x.status === 'error').length;
    const warnings = checks.filter(x => x.status === 'warning').length;
    const score = Math.max(0, Math.round(100 - errors * 35 - critical * 30 - warnings * 8));
    return { ok: critical === 0 && errors === 0, generatedAt:new Date().toISOString(), runtime:{ node:process.versions.node, platform:process.platform, arch:process.arch, uptimeSeconds:Math.floor(process.uptime()), memory:process.memoryUsage(), port:Number(process.env.PORT || 8787) }, checks, summary:{ score, errors, warnings, critical, aiRequired:false } };
  }
  mission(goal) {
    const text = str(goal);
    if (!text) throw new Error('Mission goal is required');
    const rules = [
      { match:/diagnos|error|fail|broken|تشغيل|خطأ|عطل|مشكلة/i, id:'diagnostics', title:'Run preflight diagnostics', action:'GET /api/control-center/health' },
      { match:/contact|customer|client|عميل|عملاء|جهات/i, id:'data-quality', title:'Validate customer data', action:'POST /api/control-center/data-quality' },
      { match:/campaign|message|send|حملة|رسائل|إرسال/i, id:'campaign-simulation', title:'Simulate campaign eligibility (no messages are sent)', action:'POST /api/control-center/simulate' },
      { match:/ai|model|agent|mcp|ذكاء|نموذج/i, id:'connector-review', title:'Review AI / MCP connector configuration', action:'GET /api/connectors and /api/connectors/catalog' },
      { match:/report|analytics|insight|تقرير|تحليل/i, id:'opportunities', title:'Analyze available records for recurring patterns', action:'POST /api/control-center/opportunities' },
      { match:/backup|restore|نسخ|استعادة/i, id:'backup-review', title:'Review backup and recovery status', action:'GET /api/platform/backup (operator review required)' }
    ];
    const steps = rules.filter(rule => rule.match.test(text)).map((rule, index) => ({ order:index+1, ...rule, status:'planned' }));
    if (!steps.length) steps.push({ order:1, id:'clarify-and-inspect', title:'Inspect available capabilities and identify missing inputs', action:'GET /api/connectors/catalog and GET /api/control-center/playbooks', status:'planned' });
    return { missionId:'mission-' + Date.now().toString(36), goal:text, mode:'plan-only', aiRequired:false, steps, safety:{ executed:false, messagesSent:0, dataChanged:false, requiresApprovalForSideEffects:true }, createdAt:new Date().toISOString() };
  }
  dataQuality(records = []) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const seen = new Set(), issues = [], summary = { total:records.length, valid:0, duplicate:0, missingPhone:0, invalidPhone:0, missingName:0, optedOut:0 };
    records.forEach((row, index) => {
      row = row && typeof row === 'object' ? row : {};
      const normalizedPhone = phone(row.phone || row.number || row.mobile);
      const problems = [];
      if (!normalizedPhone) { summary.missingPhone++; problems.push('missing_phone'); }
      else if (normalizedPhone.length < 7 || normalizedPhone.length > 15) { summary.invalidPhone++; problems.push('invalid_phone'); }
      if (!str(row.name || row.fullName || row.displayName)) { summary.missingName++; problems.push('missing_name'); }
      if (normalizedPhone && seen.has(normalizedPhone)) { summary.duplicate++; problems.push('duplicate_phone'); }
      if (normalizedPhone) seen.add(normalizedPhone);
      if (isOptedOut(row)) { summary.optedOut++; problems.push('opted_out'); }
      if (!problems.length) summary.valid++;
      if (problems.length) issues.push({ index, id:str(row.id)||null, phoneMasked:normalizedPhone ? normalizedPhone.replace(/.(?=.{4})/g,'*') : null, problems });
    });
    return { generatedAt:new Date().toISOString(), summary, issues, changesApplied:false };
  }
  changeRadar(before = [], after = []) {
    if (!Array.isArray(before) || !Array.isArray(after)) throw new TypeError('before and after must be arrays');
    const map = rows => new Map(rows.map((row,i) => [recordKey(row,i), row]));
    const a = map(before), b = map(after), added = [], removed = [], changed = [];
    for (const [key,row] of b) {
      if (!a.has(key)) added.push({ key, row });
      else if (JSON.stringify(a.get(key)) !== JSON.stringify(row)) changed.push({ key, before:a.get(key), after:row });
    }
    for (const [key,row] of a) if (!b.has(key)) removed.push({ key, row });
    return { generatedAt:new Date().toISOString(), counts:{ before:before.length, after:after.length, added:added.length, removed:removed.length, changed:changed.length }, added, removed, changed, changesApplied:false };
  }
  opportunities(records = []) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const buckets = new Map();
    for (const row of records) {
      const value = str(row && (row.product || row.category || row.topic || row.lastMessage || row.message || row.subject));
      if (!value) continue;
      const key = value.toLowerCase().slice(0,120);
      const item = buckets.get(key) || { topic:value.slice(0,160), count:0, evidence:[] };
      item.count++;
      if (item.evidence.length < 3) item.evidence.push({ id:str(row.id)||null, source:str(row.source)||null });
      buckets.set(key,item);
    }
    const ranked = [...buckets.values()].sort((a,b) => b.count-a.count || a.topic.localeCompare(b.topic)).slice(0,25);
    return { generatedAt:new Date().toISOString(), inputRecords:records.length, opportunities:ranked.map(x=>({...x, signal:x.count>=5?'repeated-pattern':x.count>=2?'recurring-pattern':'single-observation', confidence:x.count>=5?'medium':'low'})), caveat:'Patterns describe only supplied records; frequency does not prove intent, demand, or lost revenue.' };
  }
  simulate({ contacts = [], message = '' } = {}) {
    if (!Array.isArray(contacts)) throw new TypeError('contacts must be an array');
    const seen = new Set(), rows = [], counts = { input:contacts.length, eligible:0, blocked:0, duplicates:0, optedOut:0, noConsent:0, invalidPhone:0, emptyMessage:0 };
    for (let i=0;i<contacts.length;i++) {
      const row = contacts[i] && typeof contacts[i] === 'object' ? contacts[i] : {};
      const p = phone(row.phone || row.number), reasons = [];
      if (!str(message)) { reasons.push('empty_message'); counts.emptyMessage++; }
      if (!p || p.length<7 || p.length>15) { reasons.push('invalid_phone'); counts.invalidPhone++; }
      if (isOptedOut(row)) { reasons.push('opted_out'); counts.optedOut++; }
      if (row.consent !== true) { reasons.push('consent_not_confirmed'); counts.noConsent++; }
      if (p && seen.has(p)) { reasons.push('duplicate_phone'); counts.duplicates++; }
      if (p) seen.add(p);
      const eligible = reasons.length===0;
      if (eligible) counts.eligible++; else counts.blocked++;
      rows.push({ index:i, id:str(row.id)||null, phoneMasked:p?p.replace(/.(?=.{4})/g,'*'):null, eligible, reasons });
    }
    return { generatedAt:new Date().toISOString(), mode:'simulation-only', counts, recipients:rows, effects:{ messagesSent:0, dataChanged:false }, rules:{ consentRequired:true, optOutOverridesConsent:true, duplicatesBlocked:true } };
  }
  playbooks() {
    return [
      { id:'termux-preflight', title:'Termux startup preflight', steps:['Run diagnostics','Verify required modules','Check port and data-directory permissions','Start server only after blockers are resolved'], aiRequired:false },
      { id:'safe-campaign', title:'Safe campaign preparation', steps:['Validate consent evidence','Exclude opt-outs','Deduplicate recipients','Simulate and review','Require operator approval before sending'], aiRequired:false },
      { id:'ai-provider-setup', title:'AI provider setup', steps:['Choose cloud or local provider','Configure endpoint and model','Store credentials encrypted','Discover available models','Run a test prompt'], aiRequired:false },
      { id:'mcp-connection', title:'MCP connector setup', steps:['Add an authorized Streamable HTTP endpoint','Test initialization','List advertised tools','Review tool schema','Call a tool explicitly'], aiRequired:false },
      { id:'data-import', title:'Data import quality', steps:['Keep original file','Validate required columns','Detect invalid and duplicate records','Review the change report','Import only after confirmation'], aiRequired:false }
    ];
  }
}
module.exports = { ControlCenter };
