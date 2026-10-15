'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT_CATALOG = Object.freeze([
  { id:'openai', name:'OpenAI API / Agents', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.openai.com/v1' },
  { id:'anthropic', name:'Anthropic Claude', kind:'model-api', protocol:'anthropic-compatible', baseUrl:'https://api.anthropic.com/v1' },
  { id:'google-gemini', name:'Google Gemini', kind:'model-api', protocol:'google-compatible', baseUrl:'https://generativelanguage.googleapis.com/v1beta' },
  { id:'nvidia-nim', name:'NVIDIA NIM / API Catalog', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://integrate.api.nvidia.com/v1' },
  { id:'deepseek', name:'DeepSeek', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.deepseek.com/v1' },
  { id:'xai', name:'xAI Grok', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.x.ai/v1' },
  { id:'mistral', name:'Mistral AI', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.mistral.ai/v1' },
  { id:'groq', name:'Groq', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.groq.com/openai/v1' },
  { id:'cerebras', name:'Cerebras Inference', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.cerebras.ai/v1' },
  { id:'openrouter', name:'OpenRouter', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://openrouter.ai/api/v1' },
  { id:'together', name:'Together AI', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.together.xyz/v1' },
  { id:'fireworks', name:'Fireworks AI', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.fireworks.ai/inference/v1' },
  { id:'huggingface', name:'Hugging Face Inference', kind:'model-api', protocol:'huggingface', baseUrl:'https://router.huggingface.co/v1' },
  { id:'cohere', name:'Cohere', kind:'model-api', protocol:'cohere', baseUrl:'https://api.cohere.com/v2' },
  { id:'perplexity', name:'Perplexity Sonar', kind:'model-api', protocol:'openai-compatible', baseUrl:'https://api.perplexity.ai' },
  { id:'ollama', name:'Ollama (local)', kind:'model-api', protocol:'openai-compatible', baseUrl:'http://127.0.0.1:11434/v1' },
  { id:'lm-studio', name:'LM Studio (local)', kind:'model-api', protocol:'openai-compatible', baseUrl:'http://127.0.0.1:1234/v1' },
  { id:'vllm', name:'vLLM (local)', kind:'model-api', protocol:'openai-compatible', baseUrl:'http://127.0.0.1:8000/v1' },
  { id:'llama-cpp', name:'llama.cpp server (local)', kind:'model-api', protocol:'openai-compatible', baseUrl:'http://127.0.0.1:8080/v1' },
  { id:'mcp-http', name:'MCP Streamable HTTP', kind:'tool-server', protocol:'mcp' },
  { id:'langgraph', name:'LangGraph Agent endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'crewai', name:'CrewAI endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'autogen', name:'Microsoft AutoGen endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'google-adk', name:'Google Agent Development Kit endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'semantic-kernel', name:'Microsoft Semantic Kernel endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'llamaindex', name:'LlamaIndex workflow endpoint', kind:'agent-runtime', protocol:'http-json' },
  { id:'dify', name:'Dify workflow API', kind:'agent-runtime', protocol:'http-json' },
  { id:'n8n', name:'n8n webhook / workflow', kind:'automation', protocol:'http-json' },
  { id:'flowise', name:'Flowise prediction API', kind:'agent-runtime', protocol:'http-json' },
  { id:'custom-api', name:'Custom API / OpenAI-compatible endpoint', kind:'custom', protocol:'openai-compatible' }
]);

function safeRead(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function safeWrite(file, value) {
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  try { fs.renameSync(tmp, file); } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; }
}
function normalizeUrl(value, allowEmpty = false) {
  const raw = String(value || '').trim();
  if (!raw && allowEmpty) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('A valid connector URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Connector URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('Do not put credentials in the URL; use the encrypted credential field');
  if (url.hash) throw new Error('Connector URL must not contain a fragment');
  return url.toString().replace(/\/$/, '');
}
function isLocalUrl(value) {
  try { const u = new URL(value); return ['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname); } catch { return false; }
}
function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(String(key)).digest(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(box, key) {
  if (!box) return {};
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(String(key)).digest(), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Cannot decrypt connector credentials; verify AI_MASTER_KEY / WA_MASTER_KEY is unchanged'); }
}
function cleanId(value) {
  const id = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80);
  if (!id) throw new Error('Connector id is required');
  return id;
}
function parseMcpBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  if (raw.startsWith('data:')) {
    const data = raw.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).filter(Boolean).pop();
    if (!data || data === '[DONE]') return {};
    return JSON.parse(data);
  }
  const lines = raw.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).filter(Boolean);
  if (lines.length) {
    for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch {} }
  }
  return JSON.parse(raw);
}

class UniversalConnectorHub {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), '.connectors'));
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.file = path.join(this.dataDir, 'connectors.json');
    this.key = String(options.masterKey || process.env.AI_MASTER_KEY || process.env.WA_MASTER_KEY || this._loadKey());
    this.timeoutMs = Math.min(120000, Math.max(1000, Number(options.timeoutMs) || 20000));
  }
  _loadKey() {
    const file = path.join(this.dataDir, 'master.key');
    try { const value = fs.readFileSync(file, 'utf8').trim(); if (value) return value; } catch {}
    const value = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(file, value + '\n', { mode: 0o600 }); } catch {}
    return value;
  }
  _rows() { return safeRead(this.file, []); }
  catalog() { return { version: '1.0.0', connectors: AGENT_CATALOG, authModes: ['none','apiKey','bearer','cookie','session','customHeaders'], protocols: ['openai-compatible','http-json','mcp','custom'], safety: { credentialsEncryptedAtRest: true, secretsReturned: false, mcpToolsRequireExplicitCall: true } }; }
  list() {
    return this._rows().map(row => ({ ...row, credentials: undefined, hasCredentials: !!row.credentialsBox, credentialMode: row.credentialMode || 'none' }));
  }
  get(id) { const row = this._rows().find(x => x.id === cleanId(id)); if (!row) throw new Error('Connector not found'); return row; }
  credentials(id) { return decrypt(this.get(id).credentialsBox, this.key); }
  upsert(input = {}) {
    const id = cleanId(input.id || input.name);
    const rows = this._rows(), old = rows.find(x => x.id === id);
    const type = String(input.type || old?.type || 'api');
    if (!['api','openai-compatible','mcp','session','cookie','agent','webhook'].includes(type)) throw new Error('Unsupported connector type');
    const endpoint = normalizeUrl(input.endpoint !== undefined ? input.endpoint : (old?.endpoint || ''), type === 'agent' && !input.endpoint && !old?.endpoint);
    const protocol = String(input.protocol || old?.protocol || (type === 'mcp' ? 'mcp' : type === 'openai-compatible' ? 'openai-compatible' : 'http-json'));
    if (!['openai-compatible','http-json','mcp','custom'].includes(protocol)) throw new Error('Unsupported connector protocol');
    const credentialMode = String(input.credentialMode || old?.credentialMode || 'none');
    if (!['none','apiKey','bearer','cookie','session','customHeaders'].includes(credentialMode)) throw new Error('Unsupported credential mode');
    const supplied = input.credentials && typeof input.credentials === 'object' ? input.credentials : null;
    const credentialsBox = supplied ? encrypt(supplied, this.key) : (old?.credentialsBox || null);
    const row = {
      id, name: String(input.name || old?.name || id).slice(0, 120),
      type, protocol, endpoint, credentialMode,
      enabled: input.enabled !== false,
      timeoutMs: Math.min(120000, Math.max(1000, Number(input.timeoutMs || old?.timeoutMs || this.timeoutMs))),
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      credentialsBox
    };
    safeWrite(this.file, [...rows.filter(x => x.id !== id), row]);
    return this.list().find(x => x.id === id);
  }
  remove(id) {
    const key = cleanId(id), rows = this._rows(), found = rows.some(x => x.id === key);
    safeWrite(this.file, rows.filter(x => x.id !== key));
    return { ok: true, removed: found, id: key };
  }
  _headers(row) {
    const c = this.credentials(row.id), headers = { Accept: 'application/json, text/event-stream' };
    if (row.credentialMode === 'apiKey' && c.apiKey) headers[String(c.headerName || 'X-API-Key')] = String(c.apiKey);
    if (row.credentialMode === 'bearer' && c.token) headers.Authorization = 'Bearer ' + String(c.token);
    if (row.credentialMode === 'session' && c.sessionToken) headers.Authorization = 'Bearer ' + String(c.sessionToken);
    if (row.credentialMode === 'cookie' && c.cookie) headers.Cookie = String(c.cookie);
    if (row.credentialMode === 'customHeaders' && c.headers && typeof c.headers === 'object') {
      for (const [k,v] of Object.entries(c.headers)) {
        if (/^(host|content-length|connection|transfer-encoding)$/i.test(k)) continue;
        headers[k] = String(v);
      }
    }
    return headers;
  }
  async _request(row, body, method = 'POST') {
    if (!row.enabled) throw new Error('Connector is disabled');
    const endpoint = normalizeUrl(row.endpoint);
    const headers = { ...this._headers(row) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), row.timeoutMs || this.timeoutMs);
    try {
      const response = await fetch(endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error' });
      const text = await response.text();
      if (!response.ok) throw new Error('Connector HTTP ' + response.status + (text ? ': ' + text.slice(0, 240) : ''));
      return { response, text };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Connector request timed out');
      if (/fetch failed/i.test(String(error.message))) throw new Error('Connector request failed; check URL, network, TLS and endpoint availability');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async health(id) {
    const row = this.get(id), started = Date.now();
    try {
      let detail = {};
      if (row.protocol === 'mcp' || row.type === 'mcp') detail = await this._mcpRequest(row, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'whatsapp-scrapper', version: '5.7.0' } });
      else {
        const { response } = await this._request(row, undefined, 'GET');
        detail = { status: response.status, contentType: response.headers.get('content-type') || '' };
      }
      return { id: row.id, ok: true, latencyMs: Date.now() - started, detail };
    } catch (error) { return { id: row.id, ok: false, latencyMs: Date.now() - started, error: String(error.message || error) }; }
  }
  async request(id, input = {}) {
    const row = this.get(id);
    if (!['api','openai-compatible','session','cookie','agent','webhook'].includes(row.type)) throw new Error('Use MCP tools endpoints for MCP connectors');
    const method = String(input.method || 'POST').toUpperCase();
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('Unsupported HTTP method');
    const result = await this._request(row, method === 'GET' || method === 'DELETE' ? undefined : (input.body === undefined ? {} : input.body), method);
    let data;
    try { data = JSON.parse(result.text); } catch { data = { text: result.text.slice(0, 10000) }; }
    return { ok: true, status: result.response.status, data };
  }
  async _mcpRequest(row, method, params = {}) {
    const id = crypto.randomBytes(6).readUIntBE(0, 6);
    const result = await this._request(row, { jsonrpc: '2.0', id, method, params }, 'POST');
    const payload = parseMcpBody(result.text);
    if (payload.error) throw new Error('MCP ' + payload.error.code + ': ' + String(payload.error.message || 'request failed'));
    return payload.result || payload;
  }
  async mcpTools(id) {
    const row = this.get(id);
    if (row.protocol !== 'mcp' && row.type !== 'mcp') throw new Error('Connector is not an MCP server');
    const result = await this._mcpRequest(row, 'tools/list', {});
    return { ok: true, tools: Array.isArray(result.tools) ? result.tools : [], nextCursor: result.nextCursor || null };
  }
  async callMcpTool(id, name, args = {}) {
    const row = this.get(id);
    if (row.protocol !== 'mcp' && row.type !== 'mcp') throw new Error('Connector is not an MCP server');
    const toolName = String(name || '').trim();
    if (!toolName || toolName.length > 160) throw new Error('Valid MCP tool name is required');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MCP arguments must be an object');
    const available = await this.mcpTools(id);
    if (!available.tools.some(tool => tool.name === toolName)) throw new Error('Tool is not advertised by this MCP server');
    const result = await this._mcpRequest(row, 'tools/call', { name: toolName, arguments: args });
    return { ok: true, result };
  }
}
module.exports = { UniversalConnectorHub, AGENT_CATALOG };
