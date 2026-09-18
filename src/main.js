const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('path');const fs=require('fs');const qrcode=require('qrcode');
const {Client,LocalAuth,MessageMedia}=require('whatsapp-web.js');
const {ContactStateManager}=require('./1-state-persistence-fix');
const {ParallelCampaignExecutor}=require('./2-parallel-processing-fix');
const {BrowserManager}=require('./3-browser-selection-fix');
const {ContactPolicy}=require('./5-contact-policy');
const {AuditLog}=require('./6-audit-log');
const {CampaignScheduler}=require('./7-scheduler');

const sessions=new Map();const dataDir=path.join(app.getPath('userData'),'data');const contactsFile=path.join(dataDir,'contacts.json');const settingsFile=path.join(dataDir,'settings.json');
fs.mkdirSync(dataDir,{recursive:true});
const DEFAULT_SETTINGS={minDelay:10,maxDelay:30,perAccountLimit:100,headless:false,parallel:false,concurrency:3,browser:'chromium',maxRetries:1,retryDelay:1000,templates:Array.from({length:10},(_,i)=>({id:i+1,name:`M${i+1}`,text:''}))};
function readJson(file,fallback){try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback}catch{return fallback}}
function writeJson(file,value){const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\\n');fs.renameSync(tmp,file)}
function settings(){return {...DEFAULT_SETTINGS,...readJson(settingsFile,{})}}
const stateManager=new ContactStateManager(contactsFile);const policy=new ContactPolicy(contactsFile);const audit=new AuditLog(path.join(dataDir,'audit.log'));const scheduler=new CampaignScheduler(path.join(dataDir,'scheduled-campaigns.json'));let win;
function createWindow(){win=new BrowserWindow({width:1400,height:900,minWidth:1100,minHeight:700,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});win.loadFile(path.join(__dirname,'renderer','index.html'))}
function emit(channel,payload){if(win&&!win.isDestroyed())win.webContents.send(channel,payload)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function randomDelay(min,max){const lo=Math.max(0,Number(min)||0),hi=Math.max(lo,Number(max)||lo);return Math.floor((Math.random()*(hi-lo+1)+lo)*1000)}

async function createSession(id,headless=false,browser='chromium'){
  if(sessions.has(id))return {ok:true,id};
  const browserManager=new BrowserManager({browser,headless,userDataDir:path.join(dataDir,'profiles',id)});
  const puppeteer=browserManager.puppeteerOptions();
  const client=new Client({authStrategy:new LocalAuth({clientId:id,dataPath:path.join(dataDir,'auth')}),puppeteer});
  const state={id,client,status:'initializing',sent:0,paused:false,stopped:false,browserManager,executor:null};
  sessions.set(id,state);
  client.on('qr',async qr=>emit('session:qr',{id,qr:await qrcode.toDataURL(qr)}));
  client.on('authenticated',()=>{state.status='authenticated';emit('session:status',{id,status:state.status,browser})});
  client.on('ready',()=>{state.status='ready';emit('session:status',{id,status:state.status,browser})});
  client.on('disconnected',reason=>{state.status='disconnected';emit('session:status',{id,status:state.status,reason});sessions.delete(id)});
  client.on('auth_failure',reason=>{state.status='auth_failure';emit('session:status',{id,status:state.status,reason})});
  await client.initialize();return {ok:true,id};
}

async function sendCampaign(payload){
  const s=sessions.get(payload.accountId);if(!s||s.status!=='ready')throw new Error('Account is not ready');
  const cfg=settings();const min=Number(payload.minDelay??cfg.minDelay),max=Number(payload.maxDelay??cfg.maxDelay);
  const limit=Math.max(0,Number(payload.limit??cfg.perAccountLimit)||cfg.perAccountLimit);
  const all=await stateManager.readContacts();
  const batch=policy.filterEligible(all).slice(0,limit);
  s.paused=false;s.stopped=false;s.sent=0;audit.append('campaign_started',{accountId:s.id,total:batch.length});
  s.executor=new ParallelCampaignExecutor({concurrency:cfg.parallel?Math.max(1,cfg.concurrency):1,maxRetries:cfg.maxRetries,retryDelay:cfg.retryDelay});
  s.executor.on('progress',d=>emit('campaign:progress',{accountId:s.id,overall:d}));
  const results=await s.executor.sendMessagesParallel(batch,async item=>{
    while(s.paused&&!s.stopped)await sleep(250);if(s.stopped)throw new Error('Campaign stopped');
    const c=item.contact;const number=String(c.phone).replace(/\\D/g,'');if(!number)throw new Error('Invalid phone');
    const chatId=number+'@c.us';const body=String(payload.template||'').replace(/\\{name\\}/gi,c.name||'').replace(/\\{phone\\}/gi,c.phone||'');
    if(payload.mediaPath&&fs.existsSync(payload.mediaPath))await s.client.sendMessage(chatId,MessageMedia.fromFilePath(payload.mediaPath),{caption:body});else await s.client.sendMessage(chatId,body);
    await stateManager.updateContactStatus(item.index,'sent',{lastSentAt:new Date().toISOString(),error:undefined});s.sent++;audit.append('message_sent',{accountId:s.id,phone:c.phone});
    emit('campaign:progress',{accountId:s.id,phone:c.phone,status:'sent',sent:s.sent,total:batch.length});await sleep(randomDelay(min,max));return true;
  });
  for(const r of results)if(r.status==='failed'){const item=batch[r.index];if(item)await stateManager.updateContactStatus(item.index,'failed',{error:r.error,lastFailedAt:new Date().toISOString()})}
  audit.append('campaign_completed',{accountId:s.id,sent:s.sent,total:batch.length});emit('campaign:done',{accountId:s.id,sent:s.sent,total:batch.length,results});return results;
}

ipcMain.handle('settings:get',()=>settings());
ipcMain.handle('settings:set',(_,value)=>{const s={...settings(),...value};writeJson(settingsFile,s);return s});
ipcMain.handle('contacts:get',()=>stateManager.readContacts());
ipcMain.handle('contacts:set',(_,value)=>stateManager.writeContacts(value));
ipcMain.handle('contacts:suppress',async(_,p)=>{const changed=policy.suppressPhone(p?.phone,p?.reason||'manual opt-out');if(changed)audit.append('contact_suppressed',{phone:policy.normalizePhone(p?.phone),reason:p?.reason||'manual opt-out'});return {changed}});
ipcMain.handle('audit:list',(_,limit)=>audit.read(limit));
ipcMain.handle('schedule:list',()=>scheduler.list());
ipcMain.handle('schedule:add',(_,job)=>scheduler.add(job));
ipcMain.handle('schedule:cancel',(_,id)=>scheduler.cancel(id));
ipcMain.handle('contacts:import',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'CSV/JSON',extensions:['csv','json']}]});if(r.canceled)return [];const raw=fs.readFileSync(r.filePaths[0],'utf8');let rows=[];if(r.filePaths[0].toLowerCase().endsWith('.json'))rows=JSON.parse(raw);else rows=raw.split(/\\r?\\n/).filter(Boolean).slice(1).map(line=>{const [phone,name='']=line.split(',');return {phone:phone.trim(),name:name.trim(),consent:false,status:'pending'}});const merged=[...await stateManager.readContacts(),...rows].filter((v,i,a)=>v.phone&&a.findIndex(x=>x.phone===v.phone)===i);await stateManager.writeContacts(merged);return merged});
ipcMain.handle('browser:list',()=>BrowserManager.detectInstalledBrowsers());
ipcMain.handle('session:create',(_,p)=>createSession(String(p.id||'').trim(),!!p.headless,p.browser||settings().browser));
ipcMain.handle('session:list',()=>[...sessions.values()].map(s=>({id:s.id,status:s.status,sent:s.sent,browser:s.browserManager.browser})));
ipcMain.handle('campaign:pause',(_,id)=>{const s=sessions.get(id);if(s){s.paused=true;s.executor?.pause()}});
ipcMain.handle('campaign:resume',(_,id)=>{const s=sessions.get(id);if(s){s.paused=false;s.executor?.resume()}});
ipcMain.handle('campaign:stop',(_,id)=>{const s=sessions.get(id);if(s){s.stopped=true;s.paused=false;s.executor?.stop()}});
ipcMain.handle('campaign:start',(_,payload)=>{sendCampaign(payload).catch(e=>{audit.append('campaign_error',{accountId:payload.accountId,error:String(e.message||e)});emit('campaign:error',{accountId:payload.accountId,error:String(e.message||e)})});return {ok:true}});
ipcMain.handle('media:pick',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Media',extensions:['png','jpg','jpeg','webp','mp3','wav','mp4','mov']}]});return r.canceled?null:r.filePaths[0]});
app.whenReady().then(createWindow);app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
