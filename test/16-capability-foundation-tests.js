'use strict';
const assert=require('assert');
const {CapabilityFoundation,CapabilityError}=require('../src/30-capability-foundation');
(async()=>{
 const calls=[];
 const hub={
  models:()=>[{id:'m1'}],
  _raw:()=>[{id:'local',enabled:true,baseUrl:'http://127.0.0.1:1234'},{id:'external',enabled:true,baseUrl:'https://example.com'},{id:'a',enabled:true,baseUrl:'http://127.0.0.1:1234'},{id:'b',enabled:true,baseUrl:'http://127.0.0.1:1234'}],
  discover:async()=>[{id:'m1'}],
  chat:async(id,p)=>{calls.push([id,p]);return {model:'m1',text:'ok',usage:null}},
  compare:async p=>p.providers.map(provider=>({provider,ok:true}))
 };
 const audit={append:(e,d)=>calls.push(['audit',e,d])};
 const f=new CapabilityFoundation({hub,audit});
 assert.equal(f.catalog().version,'1.0.0');
 const r=await f.execute({task:'chat',provider:'local',messages:[{role:'user',content:'hi'}]});
 assert.equal(r.ok,true);
 assert.ok(calls.some(x=>x[0]==='local'));
 await assert.rejects(()=>f.execute({task:'generate',provider:'local'}),CapabilityError);
 const localOnly=new CapabilityFoundation({hub,audit,policy:{allowLocal:false}});
 await assert.rejects(()=>localOnly.execute({task:'chat',provider:'local',messages:[{role:'user',content:'hi'}]}),CapabilityError);
 const externalOnly=new CapabilityFoundation({hub,audit,policy:{allowExternal:false}});
 await assert.rejects(()=>externalOnly.execute({task:'chat',provider:'external',messages:[{role:'user',content:'hi'}]}),CapabilityError);
 const fb=await f.fallback({task:'chat',providers:['local'],messages:[{role:'user',content:'hi'}]});
 assert.equal(fb.provider,'local');
 await assert.rejects(()=>f.execute({task:'bad',provider:'local'}),CapabilityError);
 assert.deepEqual((await f.compare({providers:['a','b']})).map(x=>x.provider),['a','b']);
 console.log('Capability Foundation tests passed');
})();