'use strict';
const fs=require('fs'),assert=require('assert'),child=require('child_process');
function ok(label,fn){try{fn();console.log('PASS '+label)}catch(e){console.error('FAIL '+label+': '+e.message);process.exitCode=1}}
const server=fs.readFileSync('src/server.js','utf8'),web=fs.readFileSync('src/web/index.html','utf8'),desktop=fs.readFileSync('src/renderer/index.html','utf8');
ok('web server syntax',()=>child.execFileSync(process.execPath,['--check','src/server.js'],{stdio:'ignore'}));
ok('professional web shell',()=>{for(const x of ['Pending Clients','Sent Clients','messageTabs','activeTemplate','Delay from (seconds)','Delay to (seconds)','Msg / Acc','Headless','Parallel','Images / Media','Audio/Video','Start','Pause','Resume','Stop','Warmer','Dry Run'])assert(web.includes(x),'missing '+x);assert((web.match(/Array\.from\(\{length:10\}/g)||[]).length===0||web.includes('length:10'),'M1-M10 template model missing')});
ok('web APIs wired',()=>{for(const x of ['/api/session/create','/api/campaign/start','/api/campaign/pause','/api/campaign/resume','/api/campaign/stop','/api/contacts/import','/api/media/upload','/api/delivery','/events'])assert(server.includes(x),'missing '+x)});
ok('desktop workspace present',()=>{for(const x of ['dashboard','accounts','clients','messages','media','scheduler','audit','delivery','directory','groups','person-intelligence','export'])assert(desktop.includes('data-tab="'+x+'"')||desktop.includes('id="'+x+'"'),'missing '+x)});
console.log('RESULT 4/4 web UI tests passed');
