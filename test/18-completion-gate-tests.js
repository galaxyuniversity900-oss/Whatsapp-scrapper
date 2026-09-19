'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const http=require('http');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'wa-scrapper-gate-'))}

(async()=>{
  const root=tmp();

  // Secret storage: confidentiality, integrity and persistence.
  const {SecretStore}=require('../src/18-secret-store');
  const secretFile=path.join(root,'secrets.json');
  const keyFile=path.join(root,'secret.key');
  const a=new SecretStore(secretFile,{keyFile,masterKey:'gate-master'});
  assert.equal(a.set('x','super-secret'),true);
  assert.equal(a.get('x'),'super-secret');
  const raw=fs.readFileSync(secretFile,'utf8');
  assert.ok(!raw.includes('super-secret'));
  const b=new SecretStore(secretFile,{keyFile,masterKey:'gate-master'});
  assert.equal(b.get('x'),'super-secret');
  const wrong=new SecretStore(secretFile,{keyFile,masterKey:'wrong'});
  assert.equal(wrong.get('x'),null);

  // AI provider boundary and key isolation.
  const {AIProviderHub}=require('../src/29-ai-provider-hub');
  const hub=new AIProviderHub({dataDir:path.join(root,'ai'),masterKey:'gate-ai'});
  assert.equal(hub.models().length,30);
  assert.ok(hub.presets().length>=6);
  assert.throws(()=>hub.upsert({id:'bad',baseUrl:'ftp://example.com',model:'x'}),/HTTP or HTTPS/);
  assert.throws(()=>hub.upsert({id:'bad',baseUrl:'https://user:pass@example.com',model:'x'}),/credentials/);
  hub.upsert({id:'local',baseUrl:'http://127.0.0.1:9',model:'x',apiKey:'secret-key'});
  assert.ok(hub.providers()[0].apiKey==='' || hub.providers()[0].apiKey==='••••••••');
  const providerRows=JSON.parse(fs.readFileSync(path.join(root,'ai','providers.json'),'utf8'));
  assert.ok(!JSON.stringify(providerRows).includes('secret-key'));

  // Capability policy: local/external controls and task validation.
  const {CapabilityFoundation,CapabilityError}=require('../src/30-capability-foundation');
  const policyHub={models:()=>[],_raw:()=>[
    {id:'local',baseUrl:'http://127.0.0.1:9',enabled:true},
    {id:'external',baseUrl:'https://example.com',enabled:true}
  ],chat:async()=>({model:'x',text:'ok',usage:null}),discover:async()=>[]};
  const cf=new CapabilityFoundation({hub:policyHub,policy:{allowLocal:false,allowExternal:true,timeoutMs:1000}});
  await assert.rejects(()=>cf.execute({task:'chat',provider:'local',messages:[{role:'user',content:'x'}]}),e=>e instanceof CapabilityError&&e.code==='LOCAL_DISABLED');
  await assert.rejects(()=>cf.execute({task:'chat',provider:'external',messages:[]}),e=>e instanceof CapabilityError&&e.code==='INPUT_REQUIRED');
  const out=await cf.execute({task:'chat',provider:'external',messages:[{role:'user',content:'x'}]});
  assert.equal(out.ok,true);

  // Server security contract and transport boundaries.
  const server=fs.readFileSync(path.join(__dirname,'..','src','server.js'),'utf8');
  for(const marker of ['API authorization required','WA_API_TOKEN','WA_ALLOWED_ORIGINS','X-API-Key','X-Frame-Options','Request too large','/events']) assert.ok(server.includes(marker),marker);

  // Consent and opt-out must remain enforced.
  const {ContactPolicy}=require('../src/5-contact-policy');
  const contactsFile=path.join(root,'contacts.json');
  const cp=new ContactPolicy(contactsFile);
  assert.equal(cp.filterEligible([{phone:'201000000001',consent:true,status:'pending'}]).length,1);
  cp.suppressPhone('201000000001','gate-test');
  assert.equal(cp.filterEligible([{phone:'201000000001',consent:true,status:'pending'}]).length,0);

  // Telegram public-only safety boundary.
  const telegram=fs.readFileSync(path.join(__dirname,'..','src','28-telegram-adapter.js'),'utf8');
  assert.ok(telegram.includes('Private/invite-only participant scraping is disabled.'));
  assert.ok(telegram.includes('Public-member listing'));
  
  console.log('Completion gate tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
