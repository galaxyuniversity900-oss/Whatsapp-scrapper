'use strict';
const crypto=require('crypto');
function id(){return 'contact-'+crypto.randomBytes(7).toString('hex');}
function normalizeGender(v){const s=String(v||'').trim().toLowerCase();return ['male','female','other','unknown'].includes(s)?s:'';}
class ContactIntelligence{
 constructor(store){this.store=store;}
 all(){return this.store.list('contacts');}
 upsert(input){
  const phone=String(input.phone||'').replace(/\D/g,'');if(!/^\d{7,15}$/.test(phone))throw new Error('Valid international phone required');
  const old=this.all().find(x=>x.phone===phone);
  const row={id:old?.id||id(),name:String(input.name||old?.name||''),phone,gender:normalizeGender(input.gender||old?.gender),consent:input.consent===true||old?.consent===true,optOut:input.optOut===true||old?.optOut===true,tags:Array.isArray(input.tags)?[...new Set(input.tags.map(String))]:old?.tags||[],notes:String(input.notes??old?.notes??''),source:String(input.source||old?.source||'manual'),customFields:{...(old?.customFields||{}),...(input.customFields||{})},createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),lastContactAt:input.lastContactAt||old?.lastContactAt||null};
  return this.store.upsert('contacts',row);
 }
 merge(primaryId,duplicateIds){
  const rows=this.all(),primary=rows.find(x=>x.id===primaryId);if(!primary)throw new Error('Primary contact not found');
  for(const did of duplicateIds||[]){const d=rows.find(x=>x.id===did);if(!d||d.id===primary.id)continue;primary.tags=[...new Set([...(primary.tags||[]),...(d.tags||[])])];primary.notes=[primary.notes,d.notes].filter(Boolean).join('\n');primary.customFields={...(d.customFields||{}),...(primary.customFields||{})};this.store.remove('contacts',d.id);}
  primary.updatedAt=new Date().toISOString();return this.store.upsert('contacts',primary);
 }
 filter(q={}){
  const gender=String(q.gender||'all').toLowerCase(),tag=q.tag?String(q.tag):null,search=String(q.search||'').toLowerCase(),consent=q.consent;
  return this.all().filter(x=>(gender==='all'||x.gender===gender)&&(tag===null||(x.tags||[]).includes(tag))&&(search===''||[x.name,x.phone,x.notes].some(v=>String(v||'').toLowerCase().includes(search)))&&(consent===undefined||x.consent===Boolean(consent))&&x.optOut!==true);
 }
 segment(name,query){const row={id:'segment-'+Date.now().toString(36),name:String(name||'Untitled'),query:query||{},updatedAt:new Date().toISOString()};return this.store.upsert('segments',row);}
 resolveSegment(id){const s=this.store.list('segments').find(x=>x.id===String(id));return s?this.filter(s.query):[];}
 score(c){let n=0;if(c.consent)n+=10;if(c.optOut)n-=100;if(c.lastContactAt)n+=5;n+=(c.tags||[]).length*2;return n;}
}
module.exports={ContactIntelligence};