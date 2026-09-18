const $=s=>document.querySelector(s);
let clients=[],settings={},mediaPaths=[];
const templates=Array.from({length:10},(_,i)=>({id:i+1,name:`M${i+1}`,text:''}));

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderConsole(){
  const pending=clients.filter(c=>c.consent===true&&c.status!=='sent'&&c.status!=='suppressed');
  const sent=clients.filter(c=>c.status==='sent');
  $('#pendingClients').innerHTML=pending.map(c=>`<div class="client-item"><span>${esc(c.name||c.phone)}</span><small>${esc(c.phone)}</small></div>`).join('')||'<div class="empty">None</div>';
  $('#sentClients').innerHTML=sent.map(c=>`<div class="client-item"><span>${esc(c.name||c.phone)}</span><small>${esc(c.phone)}</small></div>`).join('')||'<div class="empty">None</div>';
  $('#pendingCount').textContent=pending.length;$('#sentCount').textContent=sent.length;
  $('#failedCount').textContent=clients.filter(c=>c.status==='failed').length;
  const sel=$('#accountSelect');if(sel)$('#accountStrip').innerHTML=Array.from(sel.options).map(o=>`<span class="account-chip">${esc(o.textContent)}</span>`).join('')||'<span class="empty">No connected account</span>';
}
function renderClients(){
  const rows=$('#clientRows');rows.innerHTML='';
  clients.forEach((c,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(c.phone)}</td><td>${esc(c.name)}</td><td><input type="checkbox" ${c.consent?'checked':''}></td><td>${esc(c.status||'pending')}</td><td>${esc(c.lastSentAt||'')}</td>`;tr.children[2].firstChild.onchange=e=>c.consent=e.target.checked;rows.appendChild(tr)});
  renderConsole();
}
function renderTemplates(){
  const box=$('#templates');box.innerHTML='';
  templates.forEach(t=>{const d=document.createElement('div');d.className='template';d.innerHTML=`<b>${esc(t.name)}</b><textarea placeholder="Template ${esc(t.name)}"></textarea>`;d.querySelector('textarea').value=t.text;d.querySelector('textarea').oninput=e=>t.text=e.target.value;box.appendChild(d)});
  $('#templateSelect').innerHTML=templates.map(t=>`<option value="${t.id-1}">${esc(t.name)}</option>`).join('');
}
function renderMedia(){
  const imgs=mediaPaths.filter(p=>/\.(png|jpe?g|webp|gif)$/i.test(p)).length;
  const av=mediaPaths.length-imgs;
  $('#imageCount').textContent=imgs;$('#avCount').textContent=av;
  $('#selectedMedia').textContent=mediaPaths.length?mediaPaths.map(p=>p.split(/[\\/]/).pop()).join(', '):'No media';
  $('#mediaPath').textContent=mediaPaths.length?mediaPaths.join('\n'):'No media selected';
}
async function refreshAccounts(){
  const a=await window.wa.listSessions();
  $('#accountCount').textContent=a.length;
  $('#accountSelect').innerHTML=a.map(x=>`<option value="${esc(x.id)}">${esc(x.id)} — ${esc(x.status)}</option>`).join('');if($('#intelAccount'))$('#intelAccount').innerHTML=a.map(x=>`<option value="${esc(x.id)}">${esc(x.id)} — ${esc(x.status)}</option>`).join('');
  $('#accountsList').innerHTML=a.map(x=>`<div class="account"><b>${esc(x.id)}</b><span>${esc(x.status)}</span><span>sent: ${x.sent}</span><span><button data-logout="${esc(x.id)}">Logout</button><button data-delete="${esc(x.id)}" class="danger">Delete</button></span></div>`).join('')||'<div class="empty">No active accounts</div>';
  renderConsole();
  document.querySelectorAll('[data-logout]').forEach(b=>b.onclick=async()=>{await window.wa.logoutSession(b.dataset.logout);await refreshAccounts()});
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this local session and account metadata?')){await window.wa.deleteSession(b.dataset.delete);await refreshAccounts()}});
}
async function refreshSchedules(){
  const rows=await window.wa.listSchedules();
  $('#scheduleList').innerHTML=rows.map(x=>`<div class="account"><b>${esc(x.id)}</b><span>${esc(x.status)}</span><span>${esc(x.runAt)}</span>${x.status==='scheduled'?`<button data-cancel-job="${esc(x.id)}">Cancel</button>`:''}</div>`).join('')||'<div class="empty">No scheduled campaigns</div>';
  document.querySelectorAll('[data-cancel-job]').forEach(b=>b.onclick=async()=>{await window.wa.cancelSchedule(b.dataset.cancelJob);await refreshSchedules()});
}
async function refreshAudit(){const rows=await window.wa.listAudit(200);$('#auditLog').textContent=rows.map(x=>JSON.stringify(x)).join('\n')}
async function refreshDelivery(){
  const rows=await window.wa.getDelivery(200),s=await window.wa.getDeliverySummary();
  $('#deliverySummary').textContent=JSON.stringify(s);
  $('#deliveryRows').innerHTML=rows.map(x=>`<tr><td>${esc(x.phone)}</td><td>${esc(x.status)}</td><td>${esc(x.ack??'—')}</td><td>${esc(x.createdAt)}</td></tr>`).join('')||'<tr><td colspan="4">No delivery records</td></tr>';
}
async function init(){
  settings=await window.wa.getSettings();
  if(Array.isArray(settings.templates))templates.splice(0,templates.length,...settings.templates);
  $('#minDelay').value=settings.minDelay;$('#maxDelay').value=settings.maxDelay;$('#limit').value=settings.perAccountLimit;
  $('#sMin').value=settings.minDelay;$('#sMax').value=settings.maxDelay;$('#sLimit').value=settings.perAccountLimit;
  $('#headless').checked=settings.headless;$('#sHeadless').checked=settings.headless;$('#parallel').checked=settings.parallel;
  $('#browser').value=settings.browser||'chromium';$('#sBrowser').value=settings.browser||'chromium';
  $('#browserPath').value=settings.browserPaths?.[settings.browser||'chromium']||'';$('#sConcurrency').value=settings.concurrency||3;
  $('#ackTimeout').value=settings.ackTimeoutSec||15;$('#failureLimit').value=settings.maxConsecutiveFailures||5;if($('#proxyUrl'))$('#proxyUrl').value=settings.proxyUrl||'';
  clients=await window.wa.getContacts();renderClients();renderTemplates();await refreshAccounts();await refreshSchedules();await refreshAudit();await refreshDelivery();renderMedia();await refreshDataViews();
}
$('#import').onclick=async()=>{clients=await window.wa.importContacts();renderClients()};
$('#saveClients').onclick=async()=>{await window.wa.setContacts(clients);renderClients()};
$('#addAccount').onclick=async()=>{const id=$('#accountId').value.trim();if(!id)return alert('Account ID is required.');try{await window.wa.createSession(id,$('#headless').checked,$('#browser').value,$('#proxyUrl')?.value.trim()||settings.proxyUrl||'',($('#proxyUser')?.value&&$('#proxyPass')?.value)?{username:$('#proxyUser').value,password:$('#proxyPass').value}:null);await refreshAccounts()}catch(e){alert(e.message)}};
$('#addSchedule').onclick=async()=>{const id=$('#scheduleId').value.trim(),runAt=$('#scheduleAt').value;if(!id||!runAt)return alert('Job ID and time are required.');const text=templates[Number($('#templateSelect').value)]?.text||$('#message').value;await window.wa.addSchedule({id,runAt,payload:{accountId:$('#accountSelect').value,template:text,mediaPaths,limit:Number($('#limit').value)}});await refreshSchedules()};
$('#pickImages').onclick=async()=>{mediaPaths=await window.wa.pickMedia('images');renderMedia()};
$('#pickAV').onclick=async()=>{mediaPaths=await window.wa.pickMedia('audio-video');renderMedia()};
$('#pickMedia').onclick=async()=>{mediaPaths=await window.wa.pickMedia('all');renderMedia()};
$('#readiness').onclick=async()=>{const id=$('#accountSelect').value;if(!id)return alert('Connect an account first.');const r=await window.wa.checkReadiness(id);$('#state').textContent=r.ready?'Ready':'Not ready';$('#log').textContent+=`\nReadiness: ${JSON.stringify(r)}`};
$('#checkReadiness').onclick=async()=>{const id=$('#accountSelect').value;const r=await window.wa.checkReadiness(id);$('#readinessResult').textContent=JSON.stringify(r,null,2)};
$('#dryRun').onclick=async()=>{const r=await window.wa.dryRun({limit:Number($('#limit').value)});$('#log').textContent+=`\nPreview: ${r.eligible}/${r.totalContacts} eligible`};
$('#start').onclick=async()=>{
  const min=Number($('#minDelay').value),max=Number($('#maxDelay').value);if(min>max)return alert('Min delay must not exceed max delay.');
  const text=templates[Number($('#templateSelect').value)]?.text||$('#message').value,accountId=$('#accountSelect').value;
  if(!accountId)return alert('Connect an account first.');if(!text.trim()&&!mediaPaths.length)return alert('Add a message or media.');
  const r=await window.wa.start({accountId,template:text,mediaPaths,minDelay:min,maxDelay:max,limit:Number($('#limit').value)});
  if(!r.ok)alert(r.error);else $('#state').textContent='Running';
};
$('#pause').onclick=()=>window.wa.pause($('#accountSelect').value);$('#resume').onclick=()=>window.wa.resume($('#accountSelect').value);$('#stop').onclick=()=>window.wa.stop($('#accountSelect').value);
$('#saveSettings').onclick=async()=>{settings=await window.wa.setSettings({minDelay:Number($('#sMin').value),maxDelay:Number($('#sMax').value),perAccountLimit:Number($('#sLimit').value),headless:$('#sHeadless').checked,parallel:$('#parallel').checked,browser:$('#sBrowser').value,concurrency:Number($('#sConcurrency').value),ackTimeoutSec:Number($('#ackTimeout').value),maxConsecutiveFailures:Number($('#failureLimit').value),browserPaths:{...(settings.browserPaths||{}),[$('#sBrowser').value]:$('#browserPath').value.trim()},proxyUrl:$('#proxyUrl')?.value.trim()||'',templates});alert('Settings saved')};
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.tab').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.tab).classList.remove('hidden');$('#title').textContent=b.textContent});
window.wa.on('session:qr',d=>{$('#qrBox').innerHTML=`<div><b>${esc(d.id)}</b><br><img src="${d.qr}" width="260"></div>`});
window.wa.on('session:status',async d=>{$('#log').textContent+=`\n[${d.id}] ${d.status}`;await refreshAccounts()});
window.wa.on('campaign:progress',d=>{const p=d.total?Math.round(d.sent/d.total*100):0;$('#bar').style.width=p+'%';$('#log').textContent+=`\n${d.phone||''}: ${d.status||'progress'}`;if(d.phone)clients=clients.map(c=>c.phone===d.phone?{...c,status:d.status}:c);renderClients()});
window.wa.on('campaign:done',async d=>{$('#state').textContent='Ready';$('#log').textContent+=`\nCompleted: ${d.sent}/${d.total}`;await refreshDelivery();await refreshAudit()});
window.wa.on('campaign:error',d=>{$('#state').textContent='Error';$('#log').textContent+=`\nERROR: ${d.error}`});
window.wa.on('delivery:ack',async d=>{$('#log').textContent+=`\nACK ${d.ack}: ${d.messageId}`;await refreshDelivery()});
window.wa.on('message:received',d=>{$('#log').textContent+=`\nIncoming from ${d.from}`});

async function refreshDataViews(){
  try{
    const summary=await window.wa.dataSummary();$('#dataSummary').textContent='Messages: '+summary.messages+' | Chats: '+summary.chats+' | Profiles: '+summary.profiles+' | Groups: '+summary.groups+' | Contacts: '+summary.contacts;
    const rows=await window.wa.getMessages(500);const q=($('#liveSearch')?.value||'').toLowerCase();
    $('#liveRows').innerHTML=rows.filter(x=>!q||JSON.stringify(x).toLowerCase().includes(q)).map(x=>'<tr><td>'+esc(x.timestamp)+'</td><td>'+esc(x.chatName||x.chatId)+'</td><td>'+esc(x.chatType+'/'+x.type)+'</td><td>'+esc(x.senderName||x.senderPhone||x.senderId)+'</td><td>'+esc(x.body)+'</td></tr>').join('')||'<tr><td colspan="5">No messages collected yet</td></tr>';
    const profiles=await window.wa.getProfiles();const contacts=profiles.length?profiles:await window.wa.getDirectoryContacts();
    $('#directoryRows').innerHTML=contacts.map(x=>'<tr><td>'+esc(x.phone)+'</td><td>'+esc(x.name||x.pushname)+'</td><td>'+esc(x.isWAContact)+'</td><td>'+esc(x.isBusiness)+'</td><td>'+esc(x.profilePictureUrl?'yes':'no')+'</td><td>'+esc(x.about)+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.address||x.location)+'</td></tr>').join('')||'<tr><td colspan="8">No directory data yet</td></tr>';
    const groups=await window.wa.getGroups();$('#groupList').innerHTML=groups.map(g=>'<details><summary>'+esc(g.name||g.id)+' ('+esc(g.participantCount)+')</summary><div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Admin</th><th>Super admin</th></tr></thead><tbody>'+((g.members||[]).map(m=>'<tr><td>'+esc(m.name)+'</td><td>'+esc(m.phone)+'</td><td>'+esc(m.isAdmin)+'</td><td>'+esc(m.isSuperAdmin)+'</td></tr>').join(''))+'</tbody></table></div></details>').join('')||'<div class="empty">No groups synced</div>';
  }catch(e){console.error(e)}
}
$('#syncChats')?.addEventListener('click',async()=>{const accountId=$('#accountSelect').value;if(!accountId)return alert('Connect an account first.');try{await window.wa.syncChats({accountId,limitMessages:Number($('#historyLimit').value)||50});await refreshDataViews()}catch(e){alert(e.message)}});
$('#refreshLive')?.addEventListener('click',refreshDataViews);$('#liveSearch')?.addEventListener('input',()=>refreshDataViews());
$('#syncContacts')?.addEventListener('click',async()=>{const accountId=$('#accountSelect').value;if(!accountId)return alert('Connect an account first.');try{await window.wa.syncContacts({accountId,includeProfiles:true});await refreshDataViews()}catch(e){alert(e.message)}});
$('#validateNumbers')?.addEventListener('click',async()=>{const accountId=$('#accountSelect').value;if(!accountId)return alert('Connect an account first.');const numbers=$('#numberList').value.split(',').map(x=>x.trim()).filter(Boolean);try{$('#validationResult').textContent=JSON.stringify(await window.wa.validateNumbers({accountId,numbers,includeProfilePicture:true}),null,2);await refreshDataViews()}catch(e){alert(e.message)}});
$('#syncGroups')?.addEventListener('click',async()=>{const accountId=$('#accountSelect').value;if(!accountId)return alert('Connect an account first.');try{await window.wa.syncGroups({accountId,includeMembers:true,includeProfiles:$('#groupProfiles').checked});await refreshDataViews()}catch(e){alert(e.message)}});
$('#analyzePerson')?.addEventListener('click',async()=>{
  const accountId=$('#intelAccount').value||$('#accountSelect').value,number=$('#intelNumber').value.trim();
  if(!accountId)return alert('Connect an account first.');if(!number)return alert('Enter a phone number.');
  const metrics={addedBy:$('#metricAddedBy').checked,groups:$('#metricGroups').checked,messages:$('#metricMessages').checked,reactions:$('#metricReactions').checked};
  if(!Object.values(metrics).some(Boolean))return alert('Select at least one metric.');
  try{
    $('#intelSummary').textContent='Analyzing...';$('#intelAdditions').innerHTML='';$('#intelGroups').innerHTML='';
    const r=await window.wa.analyzeGroupIntelligence({accountId,number,metrics,limitMessages:Number($('#intelLimit').value)||200});
    const parts=[`Number: ${r.targetPhone}`];if(r.addedTimes!==undefined)parts.push(`Added times: ${r.addedTimes}`);if(r.groupsEncountered!==undefined)parts.push(`Groups encountered: ${r.groupsEncountered}`);if(r.messageCount!==undefined)parts.push(`Messages: ${r.messageCount}`);if(r.reactionCount!==undefined)parts.push(`Reactions: ${r.reactionCount}`);if(r.reactionBreakdown)parts.push(`Reaction types: ${JSON.stringify(r.reactionBreakdown)}`);
    if(r.addedBy!==undefined)parts.push(`Adders: ${r.addedBy.map(x=>x.name||x.phone).join(', ')||'None found'}`);$('#intelSummary').textContent=parts.join(' | ');
    $('#intelAdditions').innerHTML=(r.additions||[]).map(x=>`<tr><td>${esc(x.groupName||x.groupId)}</td><td>${esc(x.addedByPhone||x.addedBy||'Unknown')}</td><td>${esc(x.action)}</td><td>${esc(x.timestamp)}</td></tr>`).join('')||'<tr><td colspan="4">No add events found in available history.</td></tr>';
    $('#intelGroups').innerHTML=(r.groups||[]).map(x=>`<tr><td>${esc(x.name||x.id)}</td><td>${esc(x.currentMember)}</td><td>${esc(x.messages)}</td><td>${esc(x.reactions)}</td></tr>`).join('')||'<tr><td colspan="4">No matching groups found.</td></tr>';
  }catch(e){$('#intelSummary').textContent='Analysis error: '+e.message}
});
$('#exportData')?.addEventListener('click',async()=>{try{const r=await window.wa.exportData({source:$('#exportSource').value,format:$('#exportFormat').value,limit:Number($('#exportLimit').value)||5000});$('#exportResult').textContent=r.canceled?'Export cancelled':JSON.stringify(r,null,2)}catch(e){$('#exportResult').textContent='Export error: '+e.message}});
window.wa.on('group:intelligence:event',d=>{if($('#log'))$('#log').textContent+='\\nGroup event: '+(d.type||'')+' '+(d.groupId||'');});
window.wa.on('group:intelligence:reaction',d=>{if($('#log'))$('#log').textContent+='\\nGroup reaction: '+(d.emoji||'');});
window.wa.on('message:stream',d=>{const line='\n['+(d.timestamp||new Date().toISOString())+'] '+(d.chatName||d.chatId)+' :: '+(d.senderName||d.senderPhone||'')+' :: '+(d.body||'');$('#log').textContent+=line;refreshDataViews()});
window.wa.on('message:edited',d=>{if($('#log'))$('#log').textContent+='\nEdited '+d.messageId;refreshDataViews()});
window.wa.on('message:revoked',d=>{if($('#log'))$('#log').textContent+='\nRevoked '+d.messageId;refreshDataViews()});
init().catch(e=>{$('#state').textContent='Error';$('#log').textContent='Initialization error: '+e.message});
