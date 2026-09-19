'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'wa-scrapper-gate-'))}

(async()=>{
  const root=tmp();

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

  const {AIProviderHub}=require('../src/29-ai-provider-hub');
  const aiDir=path.join(root,'ai');
  const hub=new AIProviderHub({dataDir:aiDir});
  assert.equal(hub.models().length,30);
  assert.ok(hub.presets().length>=6);
  assert.throws(()=>hub.upsert({id:'bad',baseUrl:'ftp://example.com',model:'x'}),/HTTP or HTTPS/);
  assert.throws(()=>hub.upsert({id:'bad',baseUrl:'https://user:pass@example.com',model:'x'}),/credentials/);
  hub.upsert({id:'local',baseUrl:'http://127.0.0.1:9',model:'x',apiKey:'secret-key'});
  assert.ok(hub.providers()[0].apiKey==='••••••••');
  const providerRows=JSON.parse(fs.readFileSync(path.join(aiDir,'providers.json'),'utf8'));
  assert.ok(!JSON.stringify(providerRows).includes('secret-key'));
  const keyText=fs.readFileSync(path.join(aiDir,'master.key'),'utf8').trim();
  assert.equal(keyText.length,64);

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

  const server=fs.readFileSync(path.join(__dirname,'..','src','server.js'),'utf8');
  for(const marker of ['API authorization required','WA_API_TOKEN','WA_ALLOWED_ORIGINS','X-API-Key','X-Frame-Options','Request too large','/events']) assert.ok(server.includes(marker),marker);

  const {ContactPolicy}=require('../src/5-contact-policy');
  const contactsFile=path.join(root,'contacts.json');
  const cp=new ContactPolicy(contactsFile);
  const consented={phone:'201000000001',consent:true,status:'pending'};
  fs.writeFileSync(contactsFile,JSON.stringify([consented]));
  assert.equal(cp.filterEligible([consented]).length,1);
  assert.equal(cp.suppressPhone(consented.phone,'gate-test'),true);
  const persisted=JSON.parse(fs.readFileSync(contactsFile,'utf8'));
  assert.equal(cp.filterEligible(persisted).length,0);
  assert.equal(persisted[0].status,'suppressed');
  assert.equal(persisted[0].optOut,true);

  const telegram=fs.readFileSync(path.join(__dirname,'..','src','28-telegram-adapter.js'),'utf8');
  assert.ok(telegram.includes('Private/invite-only participant scraping is disabled.'));
  assert.ok(telegram.includes('Public-member listing'));

  console.log('Completion gate tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
