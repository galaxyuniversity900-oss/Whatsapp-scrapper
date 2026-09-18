'use strict';
const fs=require('fs');
const path=require('path');

function normPhone(v){return String(v??'').replace(/[^0-9]/g,'');}
function bool(v){return v===true||/^(1|true|yes|y)$/i.test(String(v??''));}
function splitCsv(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
function parseCsv(raw){const lines=String(raw).replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return[];const h=splitCsv(lines.shift()).map(x=>x.trim().toLowerCase());return lines.map(l=>{const v=splitCsv(l),o={};h.forEach((k,i)=>o[k]=v[i]??'');return o;});}
function parseJson(raw){const j=JSON.parse(raw);return Array.isArray(j)?j:(Array.isArray(j.contacts)?j.contacts:Array.isArray(j.data)?j.data:[]);}
function unfoldVcf(raw){return String(raw).replace(/\r\n[ \t]/g,'').replace(/\n[ \t]/g,'\n');}
function parseVcf(raw){const lines=unfoldVcf(raw).split(/\r?\n/);const out=[];let c=null;for(const line of lines){if(/^BEGIN:VCARD/i.test(line)){c={};continue;}if(/^END:VCARD/i.test(line)){if(c)out.push(c);c=null;continue;}if(!c)continue;const m=line.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);if(!m)continue;const k=m[1].toUpperCase(),v=m[2];if(k==='FN')c.name=v;else if(k==='TEL')c.phone=v;else if(k==='GENDER')c.gender=v;else if(k==='EMAIL')c.email=v;else if(k==='ORG')c.company=v;}return out;}
function parseText(raw){return String(raw).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(phone=>({phone}));}
function parseImport(raw,format){const f=String(format||'').toLowerCase();if(f==='json')return parseJson(raw);if(f==='vcf'||f==='vcard')return parseVcf(raw);if(f==='txt'||f==='text')return parseText(raw);if(f==='jsonl'||f==='ndjson')return String(raw).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));return parseCsv(raw);}
function normalizeRows(rows){return rows.map((x,i)=>{const phone=normPhone(x.phone||x.tel||x.mobile||x.number||x.phoneNumber);return {...x,phone,name:String(x.name||x.fn||x.fullName||'').trim(),gender:String(x.gender||'').trim().toLowerCase(),consent:bool(x.consent),optOut:bool(x.optOut),status:x.status||'pending',importedAt:x.importedAt||new Date().toISOString(),sourceIndex:i};}).filter(x=>/^\d{7,15}$/.test(x.phone));}
class ContactDirectory{
 constructor(file){this.file=path.resolve(file);fs.mkdirSync(path.dirname(this.file),{recursive:true});}
 read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}catch{return[];}}
 write(rows){const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n');fs.renameSync(tmp,this.file);}
 import(raw,format){const incoming=normalizeRows(parseImport(raw,format));const rows=this.read();const map=new Map(rows.map(r=>[normPhone(r.phone),r]));for(const r of incoming){const old=map.get(r.phone);map.set(r.phone,{...(old||{}),...r,phone:r.phone});}const merged=[...map.values()];this.write(merged);return{imported:incoming.length,total:merged.length,contacts:merged};}
 upsert(contact){const rows=this.read(),phone=normPhone(contact.phone);if(!/^\d{7,15}$/.test(phone))throw new Error('Invalid phone number');const i=rows.findIndex(x=>normPhone(x.phone)===phone);const row={...(i>=0?rows[i]:{}),...contact,phone};if(i>=0)rows[i]=row;else rows.push(row);this.write(rows);return row;}
 remove(phone){const p=normPhone(phone),rows=this.read(),next=rows.filter(x=>normPhone(x.phone)!==p);this.write(next);return rows.length-next.length;}
 filter(opts={}){const gender=String(opts.gender||'all').toLowerCase();return this.read().filter(x=>gender==='all'||String(x.gender||'').toLowerCase()===gender);}
}
module.exports={ContactDirectory,parseImport,normalizeRows,normPhone};
