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
const dataDir=path.join(ROOT,'data'); fs.mkdirSync(dataDir,{recursive:true});
const state=new ContactStateManager(path.join(dataDir,'contacts.json'));
const policy=new ContactPolicy(path.join(dataDir,'contacts.json'));
const audit=new AuditLog(path.join(dataDir,'audit.log'));
const delivery=new DeliveryTracker(path.join(dataDir,'delivery.json'));
const registry=new AccountRegistry(path.join(dataDir,'accounts.json'));
const collector=new DataCollector(path.join(dataDir,'whatsapp-data'));
const directory=new WhatsAppDirectory({includeProfiles:true});
const sessions=new Map(), clients=new Set(), listeners=new Set();

function send(res,status,data,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(type==='application/json'?JSON.stringify(data):data)}
function broadcast(event,data){const line=`event: ${event}
data: ${JSON.stringify(data)}

`;for(const res of listeners){try{res.write(line)}catch{listeners.delete(res)}}}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function normalize(id){return String(id||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64)}
async function createSession(input={}){
 const id=normalize(input.id); if(!id)throw Error('Account ID required'); if(sessions.has(id))return {ok:true,id,existing:true};
 const browser=input.browser||'chromium', headless=input.headless!==false;
 if(!['chromium','chrome','edge'].includes(browser))throw Error('Unsupported browser');
 const bm=new BrowserManager({browser,headless,executablePath:input.executablePath||process.env.CHROME_BIN||null,proxyUrl:input.proxyUrl||null});
 const client=new Client({authStrategy:new LocalAuth({clientId:id,dataPath:path.join(dataDir,'auth')}),puppeteer:bm.puppeteerOptions()});
 const s={id,client,status:'initializing',sent:0,browser};
 sessions.set(id,s);clients.add(client);registry.upsert({id,browser,headless,enabled:true});
 client.on('qr',async qr=>{const data=await qrcode.toDataURL(qr);broadcast('qr',{id,qr:data})});
 client.on('authenticated',()=>{s.status='authenticated';audit.append('account_authenticated',{accountId:id});broadcast('session:status',{id,status:s.status})});
 client.on('ready',()=>{s.status='ready';audit.append('account_ready',{accountId:id,browser});broadcast('session:status',{id,status:s.status,browser})});
 client.on('change_state',waState=>broadcast('session:status',{id,status:s.status,waState}));
 client.on('message_ack',(m,ack)=>{const mid=m?.id?._serialized;if(mid){delivery.ack(mid,ack);broadcast('delivery:ack',{id,messageId:mid,ack})}});
 client.on('message_create',async m=>{try{const c=await m.getChat();const row=collector.ingest(m,c);broadcast('message:stream',{accountId:id,...row})}catch(e){audit.append('message_collect_error',{accountId:id,error:String(e.message||e)})}});
 client.on('message',m=>broadcast('message:received',{accountId:id,from:m?.from||'',body:m?.body||'',messageId:m?.id?._serialized||''}));
 client.on('disconnected',reason=>{s.status='disconnected';broadcast('session:status',{id,status:s.status,reason:String(reason)});sessions.delete(id);clients.delete(client)});
 client.on('auth_failure',reason=>{s.status='auth_failure';broadcast('session:status',{id,status:s.status,reason:String(reason)})});
 await client.initialize(); return {ok:true,id};
}
async function sendCampaign(p={}){
 const s=sessions.get(String(p.accountId||''));if(!s||s.status!=='ready')throw Error('Account is not ready');
 const all=await state.readContacts(),limit=Math.max(0,Number(p.limit||100));const eligible=policy.filterEligible(all).slice(0,limit);
 const text=String(p.template||'').trim();if(!text)throw Error('Campaign message is empty');
 const results=[];for(const item of eligible){const c=item.contact||item;const phone=policy.normalizePhone(c.phone);if(!/^\d{7,15}$/.test(phone)){results.push({phone,status:'failed',error:'Invalid phone number'});continue}
   try{const msg=await s.client.sendMessage(phone+'@c.us',text.replace(/\{name\}/gi,c.name||'').replace(/\{phone\}/gi,c.phone||''));const mid=msg?.id?._serialized||'local-'+Date.now();delivery.create({id:mid,accountId:s.id,phone:c.phone,contactIndex:item.index});await state.updateContactStatus(item.index,'sent',{lastSentAt:new Date().toISOString()});s.sent++;results.push({phone,status:'sent',messageId:mid});broadcast('campaign:progress',{accountId:s.id,phone,status:'sent',sent:s.sent,total:eligible.length});}
   catch(e){await state.updateContactStatus(item.index,'failed',{error:String(e.message||e),lastFailedAt:new Date().toISOString()});results.push({phone,status:'failed',error:String(e.message||e)});broadcast('campaign:progress',{accountId:s.id,phone,status:'failed',error:String(e.message||e)})}
 }
 broadcast('campaign:done',{accountId:s.id,sent:s.sent,total:eligible.length,results});return results;
}
async function route(req,res){
 const u=new URL(req.url,'http://localhost');const p=u.pathname;
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
 if(req.method==='GET'&&p==='/'){const html=fs.readFileSync(path.join(__dirname,'web','index.html'),'utf8');return send(res,200,html,'text/html; charset=utf-8')}
 if(req.method==='GET'&&p==='/manifest.json'){return send(res,200,fs.readFileSync(path.join(__dirname,'web','manifest.json'),'utf8'),'application/manifest+json')}
 if(req.method==='GET'&&p==='/sw.js'){return send(res,200,fs.readFileSync(path.join(__dirname,'web','sw.js'),'utf8'),'application/javascript')}
 if(req.method==='GET'&&p==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});res.write(': connected

');listeners.add(res);req.on('close',()=>listeners.delete(res));return}
 if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,platform:process.platform,node:process.version,root:ROOT,sessions:sessions.size});
 try{
  if(req.method==='GET'&&p==='/api/sessions')return send(res,200,[...sessions.values()].map(s=>({id:s.id,status:s.status,browser:s.browser,sent:s.sent})));
  if(req.method==='GET'&&p==='/api/accounts')return send(res,200,registry.list());
  if(req.method==='GET'&&p==='/api/contacts')return send(res,200,await state.readContacts());
  if(req.method==='GET'&&p==='/api/data/summary')return send(res,200,collector.summary());
  if(req.method==='GET'&&p==='/api/delivery')return send(res,200,delivery.list(Number(u.searchParams.get('limit')||100)));
  if(req.method==='POST'&&p==='/api/session/create')return send(res,200,await createSession(await body(req)));
  if(req.method==='POST'&&p==='/api/campaign/start')return send(res,200,{ok:true,results:await sendCampaign(await body(req))});
  if(req.method==='POST'&&p==='/api/session/logout'){const x=await body(req),s=sessions.get(normalize(x.id));if(s){try{await s.client.logout()}catch{}sessions.delete(s.id);clients.delete(s.client)}registry.upsert({id:normalize(x.id),enabled:false});return send(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/shutdown'){for(const s of sessions.values()){try{await s.client.destroy()}catch{}}return send(res,200,{ok:true})}
  return send(res,404,{ok:false,error:'Not found'});
 }catch(e){audit.append('server_error',{path:p,error:String(e.message||e)});return send(res,400,{ok:false,error:String(e.message||e)})}
}
const port=Math.max(1,Number(process.env.PORT||8787)),host=process.env.HOST||'127.0.0.1';
const server=http.createServer(route);server.listen(port,host,()=>{console.log(`WhatsApp Scrapper Web Server listening on http://${host}:${port}`);console.log(`Data directory: ${ROOT}`)});
process.on('SIGINT',async()=>{for(const s of sessions.values()){try{await s.client.destroy()}catch{}}server.close(()=>process.exit(0))});
process.on('SIGTERM',()=>process.emit('SIGINT'));
