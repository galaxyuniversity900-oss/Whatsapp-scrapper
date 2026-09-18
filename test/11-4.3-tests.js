'use strict';
const assert=require('assert');
const {parseImport,normalizeRows}=require('../src/16-contact-directory');
const {MultiAccountOrchestrator}=require('../src/15-multi-account-orchestrator');
const {sendCloud}=require('../src/17-cloud-api');
let passed=0;
function ok(name,fn){fn();console.log('PASS '+name);passed++;}
ok('CSV import',()=>assert.equal(parseImport('name,phone,gender\nA,201012345678,male','csv').length,1));
ok('VCF import',()=>assert.equal(parseImport('BEGIN:VCARD\nFN:A\nTEL:+201012345678\nGENDER:male\nEND:VCARD','vcf')[0].phone,'+201012345678'));
ok('JSON import',()=>assert.equal(parseImport('[{"name":"A","phone":"201012345678"}]','json').length,1));
ok('normalization',()=>assert.equal(normalizeRows([{name:'A',phone:'+20 10 1234 5678'}])[0].phone,'201012345678'));
ok('explicit gender only',()=>assert.equal(normalizeRows([{name:'Female Name',phone:'201012345678'}])[0].gender,''));
ok('multi-account capacity >10',()=>assert.ok(new MultiAccountOrchestrator(require('path').join(require('os').tmpdir(),'wa-43-schedules.json')).capacity(10).canCreate));
ok('schedule',()=>{const o=new MultiAccountOrchestrator(require('path').join(require('os').tmpdir(),'wa-43-schedules-2.json'));const r=o.schedule({accountId:'A',runAt:new Date(Date.now()+60000).toISOString()});assert.equal(r.status,'scheduled');o.cancel(r.id);assert.equal(o.listSchedules()[0].status,'cancelled');});
console.log('RESULT '+passed+'/7 passed');
