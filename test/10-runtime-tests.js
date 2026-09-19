'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');
const http=require('http');

const port=19000+Math.floor(Math.random()*500);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wa-runtime-'));
const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',WA_DATA_DIR:root},stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',d=>output+=d.toString());
child.stderr.on('data',d=>output+=d.toString());

function get(pathname,headers={}){
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:pathname,headers},res=>{
      let raw='';res.on('data',d=>raw+=d);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)})}catch(e){reject(e)}})
    });req.on('error',reject)
  });
}
async function waitForServer(){
  for(let i=0;i<40;i++){try{return await get('/api/health')}catch{await new Promise(r=>setTimeout(r,100))}}
  throw new Error('server did not start: '+output);
}
(async()=>{
  try{
    const unauth=await waitForServer();
    assert.strictEqual(unauth.status,401);
    const tokenResponse=await get('/api/security/token');
    assert.strictEqual(tokenResponse.status,200);
    const token=tokenResponse.body.token;
    assert.ok(token);
    const auth={'X-API-Key':token};
    const health=await get('/api/health',auth);
    assert.strictEqual(health.status,200);
    assert.strictEqual(health.body.ok,true);
    const browser=await get('/api/browser',auth);
    assert.strictEqual(browser.status,200);
    const sessions=await get('/api/sessions',auth);
    assert.deepStrictEqual(sessions.body,[]);
    const contacts=await get('/api/contacts',auth);
    assert.deepStrictEqual(contacts.body,[]);
    const runtime=await get('/api/runtime',auth);
    assert.strictEqual(runtime.body.health.sessions,0);
    assert.ok(Array.isArray(runtime.body.sessions));
    console.log('PASS real server health');
    console.log('PASS browser discovery endpoint');
    console.log('PASS real session API baseline');
    console.log('PASS real contacts/data API baseline');
    console.log('RESULT 4/4 runtime integration tests passed');
  }catch(e){console.error('FAIL runtime integration: '+e.message);process.exitCode=1}
  finally{child.kill('SIGTERM');setTimeout(()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}},100)}
})();
