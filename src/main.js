const {app,BrowserWindow,ipcMain,dialog,utilityProcess}=require('electron');
const path=require('path');const fs=require('fs');const qrcode=require('qrcode');
const {Client,LocalAuth,MessageMedia}=require('whatsapp-web.js');
const {ContactStateManager}=require('./1-state-persistence-fix');
const {ParallelCampaignExecutor}=require('./2-parallel-processing-fix');
const {BrowserManager}=require('./3-browser-selection-fix');
const {ContactPolicy}=require('./5-contact-policy');
const {AuditLog}=require('./6-audit-log');
const {CampaignScheduler}=require('./7-scheduler');
const {DeliveryTracker}=require('./8-delivery-tracker');
const {AccountRegistry}=require('./9-account-registry');
const {DataCollector}=require('./10-data-collector');
const {exportData}=require('./11-exporter');
const {WhatsAppDirectory}=require('./12-whatsapp-directory');
const {GroupIntelligence}=require('./13-group-intelligence');

const sessions=new Map();
const dataDir=path.join(app.getPath('userData'),'data');
const contactsFile=path.join(dataDir,'contacts.json');
const settingsFile=path.join(dataDir,'settings.json');
fs.mkdirSync(dataDir,{recursive:true});

const DEFAULT_SETTINGS={
  minDelay:10,maxDelay:30,perAccountLimit:100,headless:false,parallel:false,concurrency:3,
  browser:'chromium',maxRetries:1,retryDelay:1000,ackTimeoutSec:15,maxConsecutiveFailures:5,proxyUrl:'',
  templates:Array.from({length:10},(_,i)=>({id:i+1,name:`M${i+1}`,text:''})),
  browserPaths:{}
};
function readJson(file,fallback){try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback}catch{return fallback}}
function writeJson(file,value){const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,file)}
function settings(){return {...DEFAULT_SETTINGS,...readJson(settingsFile,{})}}

const stateManager=new ContactStateManager(contactsFile);
const policy=new ContactPolicy(contactsFile);
const audit=new AuditLog(path.join(dataDir,'audit.log'));
const scheduler=new CampaignScheduler(path.join(dataDir,'scheduled-campaigns.json'));
const delivery=new DeliveryTracker(path.join(dataDir,'delivery.json'));
const registry=new AccountRegistry(path.join(dataDir,'accounts.json'));
const collector=new DataCollector(path.join(dataDir,'whatsapp-data'));
const directory=new WhatsAppDirectory({includeProfiles:true});
const groupIntelligence=new GroupIntelligence(path.join(dataDir,'whatsapp-data','group-intelligence.json'));
let win=null;\nlet localService=null;\nconst servicePort=8787;\nfunction serviceMasterKey(){\n  const file=path.join(dataDir,'service-master.key');\n  try { if(fs.existsSync(file)) return fs.readFileSync(file,'utf8').trim(); } catch {}\n  const crypto=require('crypto');\n  const key=crypto.randomBytes(32).toString('base64url');\n  try { fs.writeFileSync(file,key+'\\n',{encoding:'utf8',mode:0o600}); } catch {}\n  return key;\n}\nfunction startLocalService(){\n  if(localService && localService.pid) return;\n  const env={...process.env,WA_DATA_DIR:dataDir,WA_MASTER_KEY:process.env.WA_MASTER_KEY||serviceMasterKey(),TG_MASTER_KEY:process.env.TG_MASTER_KEY||process.env.WA_MASTER_KEY||serviceMasterKey(),PORT:String(servicePort),HOST:'127.0.0.1'};\n  const entry=path.join(__dirname,'server.js');\n  localService=utilityProcess.fork(entry,[],{env,cwd:__dirname,serviceName:'WhatsApp Scrapper Local Service',session:{stdout:'ignore',stderr:'ignore'}});\n  localService.on('exit',()=>{localService=null;});\n  localService.on('error',()=>{localService=null;});\n}\nfunction stopLocalService(){try{localService?.kill()}catch{} localService=null;}

function createWindow(){
  win=new BrowserWindow({
    width:1400,height:900,minWidth:1100,minHeight:700,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}
  });
  win.loadFile(path.join(__dirname,'renderer','index.html'));
}
function emit(channel,payload){if(win&&!win.isDestroyed())win.webContents.send(channel,payload)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function randomDelay(min,max){const lo=Math.max(0,Number(min)||0),hi=Math.max(lo,Number(max)||lo);return Math.floor((Math.random()*(hi-lo+1)+lo)*1000)}
function normalizeId(id){return String(id||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64)}
function parseBool(v){return /^(1|true|yes|y)$/i.test(String(v||'').trim())}

async function createSession(rawId,headless=false,browser='chromium',proxyUrl='',proxyAuth=null){
  const id=normalizeId(rawId);
  if(!id)throw new Error('A valid account ID is required');
  if(sessions.has(id))return {ok:true,id,existing:true};
  if(!['chromium','chrome','edge'].includes(browser))throw new Error('Unsupported browser');
  const cfg=settings();
  const executablePath=cfg.browserPaths?.[browser]||null;
  const browserManager=new BrowserManager({browser,headless,executablePath,proxyUrl:proxyUrl||cfg.proxyUrl||null});
  const client=new Client({
    authStrategy:new LocalAuth({clientId:id,dataPath:path.join(dataDir,'auth')}),
    puppeteer:browserManager.puppeteerOptions(),
    ...(proxyAuth?.username&&proxyAuth?.password?{proxyAuthentication:{username:String(proxyAuth.username),password:String(proxyAuth.password)}}:{})
  });
  const state={id,client,status:'initializing',sent:0,paused:false,stopped:false,consecutiveFailures:0,browserManager,executor:null};
  sessions.set(id,state);
  registry.upsert({id,browser,headless,enabled:true});

  client.on('qr',async qr=>emit('session:qr',{id,qr:await qrcode.toDataURL(qr)}));
  client.on('authenticated',()=>{state.status='authenticated';audit.append('account_authenticated',{accountId:id});emit('session:status',{id,status:state.status,browser})});
  client.on('ready',()=>{state.status='ready';state.consecutiveFailures=0;audit.append('account_ready',{accountId:id,browser});emit('session:status',{id,status:state.status,browser})});
  client.on('change_state',waState=>{state.waState=waState;emit('session:status',{id,status:state.status,waState,browser})});
  client.on('message_ack',(message,ack)=>{
    const messageId=message?.id?._serialized;
    if(messageId){
      const row=delivery.ack(messageId,ack);
      audit.append('message_ack',{accountId:id,messageId,ack});
      emit('delivery:ack',{accountId:id,messageId,ack,status:row?.status||'acknowledged'});
    }
  });
  client.on('message_create',async message=>{
    try{const chat=await message.getChat();const row=collector.ingest(message,chat);emit('message:stream',{accountId:id,...row});}catch(e){audit.append('message_collect_error',{accountId:id,error:String(e.message||e)})}
  });
  client.on('group_join',notification=>{
    try{const row=groupIntelligence.recordJoin(notification,'join');audit.append('group_member_joined',{accountId:id,groupId:notification?.chatId,addedBy:notification?.author,recipients:notification?.recipientIds||[]});emit('group:intelligence:event',{accountId:id,type:'join',...row});}catch(e){audit.append('group_intelligence_event_error',{accountId:id,error:String(e.message||e)})}
  });
  client.on('group_leave',notification=>{
    try{const row=groupIntelligence.recordJoin(notification,'leave');audit.append('group_member_left',{accountId:id,groupId:notification?.chatId,removedBy:notification?.author,recipients:notification?.recipientIds||[]});emit('group:intelligence:event',{accountId:id,type:'leave',...row});}catch(e){audit.append('group_intelligence_event_error',{accountId:id,error:String(e.message||e)})}
  });
  client.on('message_reaction',async reaction=>{
    try{const message=await client.getMessageById(reaction?.msgId?._serialized||reaction?.msgId);const row=groupIntelligence.recordReaction(reaction,message);if(row)emit('group:intelligence:reaction',{accountId:id,...row});}catch(e){audit.append('group_intelligence_reaction_error',{accountId:id,error:String(e.message||e)})}
  });
  client.on('message',(message)=>{
    audit.append('message_received',{accountId:id,from:message?.from||'',messageId:message?.id?._serialized||''});
    emit('message:received',{accountId:id,from:message?.from||'',body:message?.body||'',messageId:message?.id?._serialized||'',timestamp:message?.timestamp||Date.now()});
  });
  client.on('message_edit',(message,newBody,prevBody)=>emit('message:edited',{accountId:id,messageId:message?.id?._serialized||'',newBody:newBody||'',prevBody:prevBody||''}));
  client.on('message_revoke_everyone',(message,revoked)=>emit('message:revoked',{accountId:id,messageId:message?.id?._serialized||'',originalMessageId:revoked?.id?._serialized||null}));
  client.on('disconnected',reason=>{
    state.status='disconnected';audit.append('account_disconnected',{accountId:id,reason:String(reason)});
    emit('session:status',{id,status:state.status,reason});sessions.delete(id);
  });
  client.on('auth_failure',reason=>{
    state.status='auth_failure';audit.append('account_auth_failure',{accountId:id,error:String(reason)});
    emit('session:status',{id,status:state.status,reason});
  });
  try{await client.initialize();return {ok:true,id}}
  catch(e){sessions.delete(id);audit.append('account_initialize_error',{accountId:id,error:String(e.message||e)});throw e}
}

async function sendMediaSet(s,chatId,mediaPaths,body){
  const paths=(Array.isArray(mediaPaths)?mediaPaths:mediaPaths?[mediaPaths]:[]).filter(p=>typeof p==='string'&&fs.existsSync(p));
  if(!paths.length){return s.client.sendMessage(chatId,body)}
  let first=true;
  for(const p of paths){
    const media=MessageMedia.fromFilePath(p);
    await s.client.sendMessage(chatId,media,first?{caption:body}:undefined);
    first=false;
  }
}
async function sendCampaign(payload={}){
  const accountId=String(payload.accountId||'');
  const s=sessions.get(accountId);
  if(!s||s.status!=='ready')throw new Error('Account is not ready');
  if(s.executor&&!s.stopped)throw new Error('A campaign is already running for this account');
  const cfg=settings();
  const min=Math.max(0,Number(payload.minDelay??cfg.minDelay)||0);
  const max=Math.max(min,Number(payload.maxDelay??cfg.maxDelay)||min);
  const limit=Math.max(0,Number(payload.limit??cfg.perAccountLimit)||cfg.perAccountLimit);
  const all=await stateManager.readContacts();
  const batch=policy.filterEligible(all).slice(0,limit);
  const text=String(payload.template||'').trim();
  if(!text&&!payload.mediaPaths&&!payload.mediaPath)throw new Error('Campaign message is empty');
  s.paused=false;s.stopped=false;s.sent=0;s.consecutiveFailures=0;
  audit.append('campaign_started',{accountId:s.id,total:batch.length,limit,minDelay:min,maxDelay:max});
  if(!batch.length){emit('campaign:done',{accountId:s.id,sent:0,total:0,results:[]});return[]}

  s.executor=new ParallelCampaignExecutor({
    concurrency:cfg.parallel?Math.max(1,Number(cfg.concurrency)||1):1,
    maxRetries:Math.max(0,Number(cfg.maxRetries)||0),
    retryDelay:Math.max(0,Number(cfg.retryDelay)||0)
  });
  s.executor.on('progress',d=>emit('campaign:progress',{accountId:s.id,overall:d}));
  const mediaPaths=Array.isArray(payload.mediaPaths)?payload.mediaPaths:(payload.mediaPath?[payload.mediaPath]:[]);
  const results=await s.executor.sendMessagesParallel(batch,async item=>{
    while(s.paused&&!s.stopped)await sleep(250);
    if(s.stopped)throw new Error('Campaign stopped');
    const c=item.contact;
    const number=policy.normalizePhone(c.phone);
    if(!/^\d{7,15}$/.test(number))throw new Error('Invalid phone number');
    const chatId=number+'@c.us';
    const body=text.replace(/\{name\}/gi,c.name||'').replace(/\{phone\}/gi,c.phone||'');
    let sentMessage=null;
    try{
      const paths=mediaPaths.filter(p=>fs.existsSync(p));
      if(paths.length){
        let first=true;
        for(const p of paths){
          const media=MessageMedia.fromFilePath(p);
          sentMessage=await s.client.sendMessage(chatId,media,first?{caption:body}:undefined);
          first=false;
        }
      }else{
        sentMessage=await s.client.sendMessage(chatId,body);
      }
      const messageId=sentMessage?.id?._serialized||`local-${s.id}-${item.index}-${Date.now()}`;
      delivery.create({id:messageId,accountId:s.id,phone:c.phone,contactIndex:item.index});
      await stateManager.updateContactStatus(item.index,'sent',{lastSentAt:new Date().toISOString(),error:undefined});
      s.sent++;s.consecutiveFailures=0;
      audit.append('message_sent',{accountId:s.id,phone:c.phone,messageId});
      emit('campaign:progress',{accountId:s.id,phone:c.phone,status:'sent',sent:s.sent,total:batch.length,messageId});
      await sleep(randomDelay(min,max));
      return {messageId};
    }catch(e){
      s.consecutiveFailures++;
      audit.append('message_failed',{accountId:s.id,phone:c.phone,error:String(e.message||e),consecutiveFailures:s.consecutiveFailures});
      if(s.consecutiveFailures>=Math.max(1,Number(cfg.maxConsecutiveFailures)||5)){s.stopped=true;s.executor.stop();audit.append('campaign_circuit_breaker',{accountId:s.id,reason:'consecutive_failures',count:s.consecutiveFailures})}
      throw e;
    }
  });
  for(const r of results)if(r.status==='failed'){const item=batch[r.index];if(item)await stateManager.updateContactStatus(item.index,'failed',{error:r.error,lastFailedAt:new Date().toISOString()})}
  audit.append('campaign_completed',{accountId:s.id,sent:s.sent,total:batch.length,failed:results.filter(x=>x.status==='failed').length});
  emit('campaign:done',{accountId:s.id,sent:s.sent,total:batch.length,results});
  s.executor=null;
  return results;
}

function parseCsvLine(line){
  const out=[];let cur='',quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){out.push(cur);cur=''}else cur+=ch}out.push(cur);return out;
}

ipcMain.handle('service:status',()=>({running:!!localService?.pid,pid:localService?.pid||null,port:servicePort,host:'127.0.0.1'}));\nipcMain.handle('settings:get',()=>settings());
ipcMain.handle('settings:set',(_,value)=>{const s={...settings(),...value};writeJson(settingsFile,s);return s});
ipcMain.handle('contacts:get',()=>stateManager.readContacts());
ipcMain.handle('contacts:set',(_,value)=>stateManager.writeContacts(value));
ipcMain.handle('contacts:suppress',async(_,p)=>{const phone=policy.normalizePhone(p?.phone);const changed=policy.suppressPhone(phone,p?.reason||'manual opt-out');if(changed)audit.append('contact_suppressed',{phone,reason:p?.reason||'manual opt-out'});return{changed}});
ipcMain.handle('contacts:import',async()=>{
  const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'CSV/JSON',extensions:['csv','json']}]});
  if(r.canceled)return stateManager.readContacts();
  const file=r.filePaths[0],raw=fs.readFileSync(file,'utf8');let rows=[];
  if(file.toLowerCase().endsWith('.json')){const parsed=JSON.parse(raw);rows=Array.isArray(parsed)?parsed:(parsed.contacts||[])}
  else{
    const lines=raw.split(/\r?\n/).filter(Boolean);const headers=(parseCsvLine(lines.shift()||'')).map(x=>x.trim().toLowerCase());
    rows=lines.map(line=>{const v=parseCsvLine(line);const o={};headers.forEach((h,i)=>o[h]=v[i]??'');return o})
  }
  const incoming=rows.map(x=>({...x,phone:policy.normalizePhone(x.phone),consent:typeof x.consent==='boolean'?x.consent:parseBool(x.consent),status:x.status||'pending'})).filter(x=>policy.validate(x).valid);
  const mergedRows=[...await stateManager.readContacts(),...incoming];const seen=new Set();const merged=mergedRows.filter(x=>{const p=policy.normalizePhone(x.phone);if(!p||seen.has(p))return false;seen.add(p);x.phone=p;return true});
  await stateManager.writeContacts(merged);audit.append('contacts_imported',{source:path.basename(file),count:incoming.length,total:merged.length});return merged;
});
ipcMain.handle('browser:list',()=>BrowserManager.detectInstalledBrowsers());
ipcMain.handle('session:create',(_,p)=>createSession(p?.id,p?.headless,p?.browser||settings().browser,p?.proxyUrl||settings().proxyUrl||'',p?.proxyAuth||null));
ipcMain.handle('session:list',()=>[...sessions.values()].map(s=>({id:s.id,status:s.status,sent:s.sent,browser:s.browserManager.browser,waState:s.waState,consecutiveFailures:s.consecutiveFailures})));
ipcMain.handle('account:list',()=>registry.list());
ipcMain.handle('session:logout',async(_,id)=>{
  const key=normalizeId(id),s=sessions.get(key);registry.upsert({id:key,enabled:false});
  if(s){try{await s.client.logout()}finally{sessions.delete(key)}}audit.append('account_logout',{accountId:key});return{ok:true}
});
ipcMain.handle('session:delete',async(_,id)=>{
  const key=normalizeId(id),s=sessions.get(key);
  if(s){try{await s.client.destroy()}catch{}sessions.delete(key)}
  const sessionDir=path.join(dataDir,'auth',`session-${key}`);try{fs.rmSync(sessionDir,{recursive:true,force:true})}catch{}
  registry.remove(key);audit.append('account_deleted',{accountId:key});return{ok:true}
});
ipcMain.handle('campaign:dry-run',async(_,payload={})=>{
  const cfg=settings(),limit=Math.max(0,Number(payload.limit??cfg.perAccountLimit)||cfg.perAccountLimit),all=await stateManager.readContacts();
  const eligible=policy.filterEligible(all).slice(0,limit);
  return{totalContacts:all.length,eligible:eligible.length,contacts:eligible.map(x=>({index:x.index,phone:x.contact.phone,name:x.contact.name||'',status:x.contact.status||'pending'}))}
});
ipcMain.handle('campaign:pause',(_,id)=>{const s=sessions.get(id);if(s){s.paused=true;s.executor?.pause()}});
ipcMain.handle('campaign:resume',(_,id)=>{const s=sessions.get(id);if(s){s.paused=false;s.executor?.resume()}});
ipcMain.handle('campaign:stop',(_,id)=>{const s=sessions.get(id);if(s){s.stopped=true;s.paused=false;s.executor?.stop()}});
ipcMain.handle('campaign:start',async(_,payload)=>{try{await sendCampaign(payload);return{ok:true}}catch(e){audit.append('campaign_error',{accountId:payload?.accountId,error:String(e.message||e)});emit('campaign:error',{accountId:payload?.accountId,error:String(e.message||e)});return{ok:false,error:String(e.message||e)}}});
ipcMain.handle('delivery:list',(_,limit)=>delivery.list(limit));
ipcMain.handle('delivery:summary',()=>delivery.summary());
ipcMain.handle('account:readiness',async(_,id)=>{
  const s=sessions.get(String(id));if(!s)return{ready:false,reason:'Account is not connected'};
  let waState=s.waState||null;try{waState=await s.client.getState()}catch{}
  return{ready:s.status==='ready',status:s.status,waState,browser:s.browserManager.browser,authenticated:['authenticated','ready'].includes(s.status),canCampaign:s.status==='ready'&&waState==='CONNECTED'}
});
ipcMain.handle('audit:list',(_,limit)=>audit.read(limit));
ipcMain.handle('schedule:list',()=>scheduler.list());
ipcMain.handle('schedule:add',(_,job)=>scheduler.add(job));
ipcMain.handle('schedule:cancel',(_,id)=>scheduler.cancel(id));
ipcMain.handle('data:summary',()=>collector.summary());
ipcMain.handle('data:messages',(_,limit)=>collector.listMessages(limit));
ipcMain.handle('data:chats',()=>collector.listChats());
ipcMain.handle('data:profiles',()=>collector.listProfiles());
ipcMain.handle('data:groups',()=>collector.listGroups());
ipcMain.handle('data:contacts',()=>collector.listContacts());
ipcMain.handle('data:sync:contacts',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');const rows=await directory.listContacts(s.client,{includeProfiles:p.includeProfiles!==false});collector.saveContacts(rows);audit.append('directory_contacts_synced',{accountId:s.id,count:rows.length});emit('data:sync:done',{type:'contacts',count:rows.length});return rows});
ipcMain.handle('data:sync:groups',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');const rows=await directory.listGroups(s.client,{includeMembers:p.includeMembers!==false,includeProfiles:!!p.includeProfiles});collector.saveGroups(rows);audit.append('directory_groups_synced',{accountId:s.id,count:rows.length});emit('data:sync:done',{type:'groups',count:rows.length});return rows});
ipcMain.handle('data:sync:chats',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');const result=await directory.syncChats(s.client,{limitMessages:Math.min(500,Math.max(1,Number(p.limitMessages)||50)),types:p.types||'all',onMessage:async(m,c)=>collector.ingest(m,c)});audit.append('chat_history_synced',{accountId:s.id,...result});emit('data:sync:done',{type:'chats',...result});return result});
ipcMain.handle('data:validate:numbers',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');return directory.validateNumbers(s.client,p.numbers||[],{includeProfilePicture:p.includeProfilePicture!==false})});
ipcMain.handle('data:group-intelligence',async(_,p={})=>{
  const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');
  const metrics={addedBy:p.metrics?.addedBy!==false,groups:p.metrics?.groups!==false,messages:p.metrics?.messages!==false,reactions:p.metrics?.reactions!==false};
  const result=await groupIntelligence.analyze(s.client,p.number,{...p,metrics});
  audit.append('group_intelligence_analyzed',{accountId:s.id,targetPhone:result.targetPhone,metrics,result:{groupsEncountered:result.groupsEncountered,addedTimes:result.addedTimes,messageCount:result.messageCount,reactionCount:result.reactionCount}});
  emit('group:intelligence:done',{accountId:s.id,...result});
  return result;
});
ipcMain.handle('data:channel:subscribers',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');return directory.channelSubscribers(s.client,p.channelId,{limit:Math.min(1000,Math.max(1,Number(p.limit)||100)),includeProfiles:!!p.includeProfiles})});
ipcMain.handle('data:search',async(_,p={})=>{const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw new Error('Account is not ready');return s.client.searchMessages(String(p.query||''),{limit:Math.min(500,Math.max(1,Number(p.limit)||50)),...(p.chatId?{chatId:String(p.chatId)}:{})})});
ipcMain.handle('data:export',async(_,p={})=>{const format=String(p.format||'json').toLowerCase();const source=p.source||'messages';const rows=source==='contacts'?collector.listContacts():source==='groups'?collector.listGroups():source==='profiles'?collector.listProfiles():source==='chats'?collector.listChats():collector.listMessages(p.limit||5000);const ext=format==='excel'?'xls':format;const r=await dialog.showSaveDialog(win,{defaultPath:'whatsapp-'+source+'.'+ext,filters:[{name:format.toUpperCase(),extensions:[ext]}]});if(r.canceled)return{canceled:true};const result=exportData(rows,format,r.filePath,'WhatsApp '+source+' export');audit.append('data_exported',{source,format,count:rows.length,file:path.basename(r.filePath)});return result});
ipcMain.handle('media:pick',async(_,kind='all')=>{
  const ext=kind==='images'?['png','jpg','jpeg','webp','gif']:kind==='audio-video'?['mp3','wav','m4a','aac','ogg','mp4','mov','webm','mkv']:['png','jpg','jpeg','webp','gif','mp3','wav','m4a','aac','ogg','mp4','mov','webm','mkv'];
  const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:kind==='images'?'Images':kind==='audio-video'?'Audio / Video':'Media',extensions:ext}]});
  return r.canceled?[]:r.filePaths;
});

async function processDueSchedules(){
  for(const job of scheduler.due()){
    scheduler.markRunning(job.id);audit.append('schedule_started',{jobId:job.id});
    try{await sendCampaign(job.payload||{});scheduler.markCompleted(job.id);audit.append('schedule_completed',{jobId:job.id})}
    catch(e){scheduler.markFailed(job.id,e.message||e);audit.append('schedule_failed',{jobId:job.id,error:String(e.message||e)})}
  }
}
setInterval(()=>processDueSchedules().catch(e=>audit.append('scheduler_error',{error:String(e.message||e)})),15000);

app.whenReady().then(()=>{startLocalService();createWindow();});
app.on('before-quit',()=>stopLocalService());\napp.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
