'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { UniversalConnectorHub, AGENT_CATALOG } = require('../src/35-universal-connector-hub');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-connectors-'));
  const hub = new UniversalConnectorHub({ dataDir: dir, masterKey: 'unit-test-master-key', timeoutMs: 1500 });
  assert.ok(AGENT_CATALOG.some(x => x.id === 'nvidia-nim'), 'NVIDIA NIM preset exists');
  assert.ok(AGENT_CATALOG.some(x => x.id === 'mcp-http'), 'MCP preset exists');
  assert.ok(AGENT_CATALOG.some(x => x.id === 'ollama'), 'local inference preset exists');
  const row = hub.upsert({ id:'cookie-test', name:'Cookie Test', type:'cookie', endpoint:'http://127.0.0.1:1/session', credentialMode:'cookie', credentials:{cookie:'sid=secret-session-value'} });
  assert.equal(row.hasCredentials, true);
  assert.equal(JSON.stringify(row).includes('secret-session-value'), false);
  const onDisk = fs.readFileSync(path.join(dir, 'connectors.json'), 'utf8');
  assert.equal(onDisk.includes('secret-session-value'), false, 'cookie/session credentials must be encrypted at rest');
  assert.equal(JSON.stringify(hub.list()).includes('credentialsBox'), false, 'public list must not expose encrypted credential blobs');
  assert.equal(hub.credentials('cookie-test').cookie, 'sid=secret-session-value');
  assert.throws(() => hub.upsert({ id:'bad', type:'api', endpoint:'file:///etc/passwd' }), /HTTP or HTTPS/);
  assert.throws(() => hub.upsert({ id:'bad-url', type:'api', endpoint:'https://user:pass@example.com' }), /credentials/);
  assert.throws(() => hub.upsert({ id:'bad-type', type:'other', endpoint:'https://example.com' }), /Unsupported connector type/);
  assert.equal(hub.remove('cookie-test').removed, true);
  assert.equal(hub.list().length, 0);

  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch {}
      seen.push({ method: body.method, session: req.headers['mcp-session-id'] || '', path: req.url });
      if (body.method === 'initialize') {
        res.writeHead(200, { 'Content-Type':'application/json', 'Mcp-Session-Id':'test-session-123', 'MCP-Protocol-Version':'2025-03-26' });
        return res.end(JSON.stringify({ jsonrpc:'2.0', id:body.id, result:{ protocolVersion:'2025-03-26', capabilities:{tools:{}}, serverInfo:{name:'test-mcp',version:'1.0.0'} } }));
      }
      if (body.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      if (body.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type':'application/json' });
        return res.end(JSON.stringify({ jsonrpc:'2.0', id:body.id, result:{ tools:[{name:'echo',description:'Echo test',inputSchema:{type:'object'}}] } }));
      }
      if (body.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type':'application/json' });
        return res.end(JSON.stringify({ jsonrpc:'2.0', id:body.id, result:{ content:[{type:'text',text:String(body.params.arguments.value)}] } }));
      }
      res.writeHead(400); res.end('unexpected method');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = 'http://127.0.0.1:' + server.address().port + '/mcp';
    hub.upsert({ id:'mcp-test', type:'mcp', protocol:'mcp', endpoint });
    const listed = await hub.mcpTools('mcp-test');
    assert.equal(listed.tools[0].name, 'echo');
    const called = await hub.callMcpTool('mcp-test', 'echo', { value:'works' });
    assert.equal(called.result.content[0].text, 'works');
    assert.ok(seen.some(x => x.method === 'initialize'));
    assert.ok(seen.some(x => x.method === 'tools/list' && x.session === 'test-session-123'), 'MCP session ID is reused');
    assert.ok(seen.some(x => x.method === 'tools/call' && x.session === 'test-session-123'), 'MCP tool call carries session ID');
    await assert.rejects(() => hub.callMcpTool('mcp-test', 'not-advertised', {}), /not advertised/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive:true, force:true });
  }
  console.log('Universal connector hub tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
