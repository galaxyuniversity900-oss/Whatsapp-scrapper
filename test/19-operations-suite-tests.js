'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'wa-ops-'))}

(async()=>{
  const root=tmp();
  const audit={append(){}};
  const policy={normalizePhone(x){return String(x||'').replace(/\D/g,'')},};
  const {OperationsSuite}=require('../src/31-operations-suite');
  const ops=new OperationsSuite(root,audit,policy);
  const f=ops.importBuffer('catalog.pdf',Buffer.from('catalog'),{mimeType:'application/pdf',tags:['catalog'],collection:'sales'});
  assert.ok(f.id);
  assert.equal(ops.listFiles({tag:'catalog'}).length,1);
  const dup=ops.importBuffer('same.pdf',Buffer.from('catalog'),{mimeType:'application/pdf'});
  assert.equal(dup.duplicate,true);

  const c=ops.createCampaign({
    name:'Test Bundle',accountId:'test-account',
    message:'Hello {name}',fileIds:[f.id]
  });
  const dry=ops.dryRun(c.id,[
    {phone:'201000000001',name:'A',consent:true},
    {phone:'201000000002',name:'B',consent:false},
    {phone:'201000000003',name:'C',consent:true,optOut:true}
  ]);
  assert.equal(dry.eligibleCount,1);
  assert.equal(dry.estimatedOperations,1);

  const sent=[];
  const result=await ops.startCampaign(c.id,[
    {phone:'201000000001',name:'A',consent:true},
    {phone:'201000000002',name:'B',consent:false}
  ],async task=>{sent.push(task);});
  assert.equal(result.status,'completed');
  assert.equal(result.sent,1);
  assert.equal(sent.length,2);
  assert.equal(sent[0].type,'text');
  assert.equal(sent[0].body,'Hello A');
  assert.equal(sent[1].type,'file');

  const p=ops.upsertProduct({sku:'SKU-1',name:'Product',price:100,fileIds:[f.id]});
  assert.equal(p.sku,'SKU-1');
  assert.equal(ops.listProducts().length,1);
  const t=ops.upsertTicket({subject:'Support',priority:'high'});
  assert.equal(t.status,'open');
  assert.equal(ops.listTickets().length,1);
  assert.ok(fs.existsSync(path.join(root,'broadcast-campaigns.json')));
  console.log('Operations suite tests passed');
})().catch(e=>{console.error(e);process.exit(1)});