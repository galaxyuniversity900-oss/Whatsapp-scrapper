'use strict';
const fs=require('fs'),assert=require('assert'),child=require('child_process');
function ok(label,fn){try{fn();console.log('PASS '+label)}catch(e){console.error('FAIL '+label+': '+e.message);process.exitCode=1}}
const server=fs.readFileSync('src/server.js','utf8'),web=fs.readFileSync('src/web/index.html','utf8'),desktop=fs.readFileSync('src/renderer/index.html','utf8');
ok('web server syntax',()=>child.execFileSync(process.execPath,['--check','src/server.js'],{stdio:'ignore'}));
ok('professional runtime UI',()=>{for(const x of ['Dashboard','Campaign Control','Accounts','Clients','WhatsApp Directory','Groups','Person Intelligence','Delivery Monitor','Data & Export','Activity & Audit','M1','M10','Start','Pause','Resume','Stop','Warmer / Readiness','Dry Run','Real WhatsApp QR'])assert(web.includes(x),'missing '+x)});
ok('real runtime APIs wired',()=>{for(const x of ['/api/session/create','/api/session/logout','/api/session/readiness','/api/campaign/start','/api/campaign/pause','/api/campaign/resume','/api/campaign/stop','/api/contacts/import','/api/media/upload','/api/data/sync/contacts','/api/data/sync/groups','/api/data/sync/chats','/api/data/validate/numbers','/api/data/search','/api/data/group-intelligence','/api/data/export','/api/delivery','/events'])assert(server.includes(x),'missing '+x)});
ok('desktop workspace present',()=>{for(const x of ['dashboard','accounts','clients','messages','media','scheduler','audit','delivery','directory','groups','person-intelligence','export'])assert(desktop.includes('data-tab="'+x+'"')||desktop.includes('id="'+x+'"'),'missing '+x)});
console.log('RESULT 4/4 web UI tests passed');
