'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),qrcode=require('qrcode');
const {Client,LocalAuth,MessageMedia}=require('whatsapp-web.js');
const {BrowserManager}=require('./3-browser-selection-fix');
const {ContactStateManager}=require('./1-state-persistence-fix');
const {ContactPolicy}=require('./5-contact-policy');
const {AuditLog}=require('./6-audit-log');
const {DeliveryTracker}=require('./8-delivery-tracker');
const {AccountRegistry}=require('./9-account-registry');
const {DataCollector}=require('./10-data-collector');
const {WhatsAppDirectory}=require('./12-whatsapp-directory');

const ROOT=path.resolve(process.env.WA_DATA_DIR||path.join(os.homedir(),'.whatsapp-scrapper'));
const dataDir=path.join(ROOT,'data'),mediaDir=path.join(ROOT,'media');
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(mediaDir,{recursive:true});
const state=new ContactStateManager(path.join(dataDir,'contacts.json'));
const policy=new ContactPolicy(path.join(dataDir,'contacts.json'));
const audit=new AuditLog(path.join(dataDir,'audit.log'));
const delivery=new DeliveryTracker(path.join(dataDir,'delivery.json'));
const registry=new AccountRegistry(path.join(dataDir,'accounts.json'));
const collector=new DataCollector(path.join(dataDir,'whatsapp-data'));
const directory=new WhatsAppDirectory({includeProfiles:true});
const sessions=new Map(),clients=new Set(),listeners=new Set(),campaigns=new Map();

function send(res,status,data,type){type=type||'application/json';res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});res.end(type==='application/json'?JSON.stringify(data):data)}
function broadcast(event,data){const line='event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n';for(const res of listeners){try{res.write(line)}catch{listeners.delete(res)}}}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>25e6){reject(new Error('Request too large'));req.destroy()}});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function normalize(id){return String(id||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64)}
function safeFileName(name){return String(name||'upload.bin').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120)}
function campaignState(id){return campaigns.get(String(id))||{status:'idle',sent:0,total:0,failed:0,startedAt:null,finishedAt:null,paused:false,stopped:false}}

async function createSession(input){
 input=input||{};const id=normalize(input.id);if(!id)throw Error('Account ID required');if(sessions.has(id))return {ok:true,id,existing:true};
 const browser=input.browser||'chromium',headless=input.headless!==false;
 if(!['chromium','chrome','edge'].includes(browser))throw Error('Unsupported browser');
 const bm=new BrowserManager({browser,headless,executablePath:input.executablePath||process.env.CHROME_BIN||null,proxyUrl:input.proxyUrl||null});
 const client=new Client({authStrategy:new LocalAuth({clientId:id,dataPath:path.join(dataDir,'auth')}),puppeteer:bm.puppeteerOptions()});
 const s={id,client,status:'initializing',sent:0,browser,headless,browserManager:bm,paused:false,stopped:false,executor:null};
 sessions.set(id,s);clients.add(client);registry.upsert({id,browser,headless,enabled:true});
 client.on('qr',async qr=>{broadcast('qr',{id,qr:await qrcode.toDataURL(qr)});broadcast('session:status',{id,status:'qr'})});
 client.on('authenticated',()=>{s.status='authenticated';audit.append('account_authenticated',{accountId:id});broadcast('session:status',{id,status:s.status,browser,headless})});
 client.on('ready',()=>{s.status='ready';audit.append('account_ready',{accountId:id,browser});broadcast('session:status',{id,status:s.status,browser,headless})});
 client.on('change_state',waState=>{s.waState=waState;broadcast('session:status',{id,status:s.status,waState,browser})});
 client.on('message_ack',(m,ack)=>{const mid=m&&m.id&&m.id._serialized;if(mid){const row=delivery.ack(mid,ack);broadcast('delivery:ack',{id,messageId:mid,ack,status:row&&row.status||'acknowledged'})}});
 client.on('message_create',async m=>{try{const c=await m.getChat();const row=collector.ingest(m,c);broadcast('message:stream',{accountId:id,...row})}catch(e){audit.append('message_collect_error',{accountId:id,error:String(e.message||e)})}});
 client.on('message',m=>broadcast('message:received',{accountId:id,from:m&&m.from||'',body:m&&m.body||'',messageId:m&&m.id&&m.id._serialized||'',timestamp:m&&m.timestamp||Date.now()}));
 client.on('disconnected',reason=>{s.status='disconnected';broadcast('session:status',{id,status:s.status,reason:String(reason)});sessions.delete(id);clients.delete(client)});
 client.on('auth_failure',reason=>{s.status='auth_failure';broadcast('session:status',{id,status:s.status,reason:String(reason)})});
 try{await client.initialize();return {ok:true,id}}catch(e){sessions.delete(id);clients.delete(client);audit.append('account_initialize_error',{accountId:id,error:String(e.message||e)});throw e}
}

async function sendCampaign(p){
 p=p||{};const accountId=String(p.accountId||''),s=sessions.get(accountId);if(!s||s.status!=='ready')throw Error('Account is not ready');
 if(s.executor)throw Error('A campaign is already running for this account');
 const min=Math.max(0,Number(p.minDelay||0)),max=Math.max(min,Number(p.maxDelay==null?min:p.maxDelay)),limit=Math.max(0,Math.min(10000,Number(p.limit||100)));
 const all=await state.readContacts(),eligible=policy.filterEligible(all).slice(0,limit),text=String(p.template||'').trim();
 const mediaPaths=(Array.isArray(p.mediaPaths)?p.mediaPaths:[]).filter(x=>typeof x==='string'&&fs.existsSync(x));
 if(!text&&!mediaPaths.length)throw Error('Campaign message is empty');
 const cstate={status:'running',sent:0,total:eligible.length,failed:0,startedAt:new Date().toISOString(),finishedAt:null,paused:false,stopped:false};campaigns.set(accountId,cstate);
 s.paused=false;s.stopped=false;s.sent=0;audit.append('campaign_started',{accountId,total:eligible.length,minDelay:min,maxDelay:max});broadcast('campaign:status',{accountId,...cstate});
 const results=[];
 for(let n=0;n<eligible.length;n++){
   while(s.paused&&!s.stopped){cstate.status='paused';cstate.paused=true;campaigns.set(accountId,cstate);broadcast('campaign:status',{accountId,...cstate});await new Promise(r=>setTimeout(r,250))}
   if(s.stopped){cstate.status='stopped';cstate.stopped=true;break}
   const item=eligible[n],c=item.contact||item,phone=policy.normalizePhone(c.phone),result={index:item.index,phone,status:'failed'};
   if(!/^\\d{7,15}$/.test(phone)){result.error='Invalid phone number';cstate.failed++;results.push(result);continue}
   try{
     const chatId=phone+'@c.us',bodyText=text.replace(/\\{name\\}/gi,c.name||'').replace(/\\{phone\\}/gi,c.phone||'');let msg=null;
     if(mediaPaths.length){for(let j=0;j<mediaPaths.length;j++){const media=MessageMedia.fromFilePath(mediaPaths[j]);msg=await s.client.sendMessage(chatId,media,j===0?{caption:bodyText}:undefined)}}else msg=await s.client.sendMessage(chatId,bodyText);
     const mid=msg&&msg.id&&msg.id._serialized||'local-'+accountId+'-'+item.index+'-'+Date.now();delivery.create({id:mid,accountId,phone:c.phone,contactIndex:item.index});
     await state.updateContactStatus(item.index,'sent',{lastSentAt:new Date().toISOString()});s.sent++;cstate.sent=s.sent;result.status='sent';result.messageId=mid;results.push(result);
     broadcast('campaign:progress',{accountId,phone,status:'sent',sent:cstate.sent,total:cstate.total,failed:cstate.failed});
   }catch(e){result.error=String(e.message||e);cstate.failed++;results.push(result);await state.updateContactStatus(item.index,'failed',{error:result.error,lastFailedAt:new Date().toISOString()});broadcast('campaign:progress',{accountId,phone,status:'failed',sent:cstate.sent,total:cstate.total,failed:cstate.failed,error:result.error})}
   if(n<eligible.length-1){const delay=Math.floor((Math.random()*(max-min+1)+min)*1000);await new Promise(r=>setTimeout(r,delay))}
 }
 if(cstate.status==='running')cstate.status='completed';cstate.finishedAt=new Date().toISOString();cstate.paused=false;campaigns.set(accountId,cstate);
 audit.append('campaign_completed',{accountId,sent:cstate.sent,total:cstate.total,failed:cstate.failed,status:cstate.status});broadcast('campaign:done',{accountId,...cstate,results});s.executor=null;return results;
}

async function route(req,res){
 const u=new URL(req.url,'http://localhost'),p=u.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
 if(req.method==='GET'&&p==='/')return send(res,200,fs.readFileSync(path.join(__dirname,'web','index.html'),'utf8'),'text/html; charset=utf-8');
 if(req.method==='GET'&&p==='/manifest.json')return send(res,200,fs.readFileSync(path.join(__dirname,'web','manifest.json'),'utf8'),'application/manifest+json');
 if(req.method==='GET'&&p==='/sw.js')return send(res,200,fs.readFileSync(path.join(__dirname,'web','sw.js'),'utf8'),'application/javascript');
 if(req.method==='GET'&&p==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});res.write(': connected\\n\\n');listeners.add(res);req.on('close',()=>listeners.delete(res));return}
 if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,platform:process.platform,node:process.version,root:ROOT,sessions:sessions.size,accounts:registry.list().length});
 try{
  if(req.method==='GET'&&p==='/api/sessions')return send(res,200,[...sessions.values()].map(s=>({id:s.id,status:s.status,browser:s.browser,headless:s.headless,waState:s.waState,sent:s.sent,campaign:campaignState(s.id)})));
  if(req.method==='GET'&&p==='/api/accounts')return send(res,200,registry.list());
  if(req.method==='GET'&&p==='/api/contacts')return send(res,200,await state.readContacts());
  if(req.method==='GET'&&p==='/api/data/summary')return send(res,200,collector.summary());
  if(req.method==='GET'&&p==='/api/delivery')return send(res,200,delivery.list(Math.min(1000,Number(u.searchParams.get('limit')||200))));
  if(req.method==='GET'&&p==='/api/delivery/summary')return send(res,200,delivery.summary());
  if(req.method==='GET'&&p==='/api/campaign/status')return send(res,200,[...campaigns.entries()].map(([id,v])=>({accountId:id,...v})));
  if(req.method==='GET'&&p==='/api/audit')return send(res,200,audit.read(Math.min(500,Number(u.searchParams.get('limit')||100))));
  if(req.method==='GET'&&p==='/api/media')return send(res,200,fs.readdirSync(mediaDir).map(name=>{const st=fs.statSync(path.join(mediaDir,name));return{name,size:st.size,path:path.join(mediaDir,name)}}));
  if(req.method==='POST'&&p==='/api/session/create')return send(res,200,await createSession(await body(req)));
  if(req.method==='POST'&&p==='/api/session/logout'){const x=await body(req),id=normalize(x.id),s=sessions.get(id);if(s){try{await s.client.logout()}catch{}sessions.delete(id);clients.delete(s.client)}registry.upsert({id,enabled:false});return send(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/campaign/start')return send(res,200,{ok:true,results:await sendCampaign(await body(req))});
  if(req.method==='POST'&&p==='/api/campaign/pause'){const x=await body(req),s=sessions.get(String(x.accountId||''));if(!s)throw Error('Account not found');s.paused=true;return send(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/campaign/resume'){const x=await body(req),s=sessions.get(String(x.accountId||''));if(!s)throw Error('Account not found');s.paused=false;return send(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/campaign/stop'){const x=await body(req),s=sessions.get(String(x.accountId||''));if(!s)throw Error('Account not found');s.stopped=true;s.paused=false;return send(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/contacts/import'){const x=await body(req),rows=Array.isArray(x.contacts)?x.contacts:[],valid=rows.map(r=>({...r,phone:policy.normalizePhone(r.phone),consent:r.consent===true||/^(1|true|yes|y)$/i.test(String(r.consent||'')),status:r.status||'pending'})).filter(r=>policy.validate(r).valid);
    const merged=[...await state.readContacts(),...valid],seen=new Set(),out=[];for(const r of merged){const phone=policy.normalizePhone(r.phone);if(phone&&!seen.has(phone)){seen.add(phone);out.push({...r,phone})}}await state.writeContacts(out);audit.append('contacts_imported',{count:valid.length,total:out.length,source:'web'});return send(res,200,{ok:true,imported:valid.length,total:out.length,contacts:out})}
  if(req.method==='POST'&&p==='/api/contacts/suppress'){const x=await body(req),phone=policy.normalizePhone(x.phone),changed=policy.suppressPhone(phone,x.reason||'manual opt-out');if(changed)audit.append('contact_suppressed',{phone,reason:x.reason||'manual opt-out'});return send(res,200,{ok:true,changed})}
  if(req.method==='POST'&&p==='/api/media/upload'){const x=await body(req);if(!x.data||typeof x.data!=='string')throw Error('Media data required');const comma=x.data.indexOf(','),buf=Buffer.from(comma>=0?x.data.slice(comma+1):x.data,'base64');if(buf.length>20e6)throw Error('Media file exceeds 20 MB');const name=Date.now()+'-'+safeFileName(x.name),file=path.join(mediaDir,name);fs.writeFileSync(file,buf);return send(res,200,{ok:true,name,size:buf.length,path:file})}
  if(req.method==='POST'&&p==='/api/shutdown'){for(const s of sessions.values()){try{await s.client.destroy()}catch{}}return send(res,200,{ok:true})}
  return send(res,404,{ok:false,error:'Not found'});
 }catch(e){audit.append('server_error',{path:p,error:String(e.message||e)});return send(res,400,{ok:false,error:String(e.message||e)})}
}
const port=Math.max(1,Number(process.env.PORT||8787)),host=process.env.HOST||'127.0.0.1';
const server=http.createServer(route);server.listen(port,host,()=>{console.log('WhatsApp Scrapper Web Server listening on http://'+host+':'+port);console.log('Data directory: '+ROOT)});
process.on('SIGINT',async()=>{for(const s of sessions.values()){try{await s.client.destroy()}catch{}}server.close(()=>process.exit(0))});
process.on('SIGTERM',()=>process.emit('SIGINT'));
