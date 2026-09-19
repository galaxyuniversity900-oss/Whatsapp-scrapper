'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function now(){ return new Date().toISOString(); }
function id(prefix){ return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'); }
function safeName(name){ return String(name || 'file.bin').replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180); }

class OperationsSuite {
  constructor(dataDir, audit, policy){
    this.root = path.resolve(dataDir);
    this.filesDir = path.join(this.root, 'media-library');
    this.exportsDir = path.join(this.root, 'exports');
    this.audit = audit;
    this.policy = policy;
    fs.mkdirSync(this.filesDir,{recursive:true});
    fs.mkdirSync(this.exportsDir,{recursive:true});
    this.filesDb = path.join(this.root,'media-library.json');
    this.campaignDb = path.join(this.root,'broadcast-campaigns.json');
    this.productDb = path.join(this.root,'products.json');
    this.ticketDb = path.join(this.root,'tickets.json');
    this.files = this._load(this.filesDb,[]);
    this.campaigns = this._load(this.campaignDb,[]);
    this.products = this._load(this.productDb,[]);
    this.tickets = this._load(this.ticketDb,[]);
    this.jobs = new Map();
  }
  _load(file,fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
  _save(file,value){ fs.writeFileSync(file,JSON.stringify(value,null,2)); }
  _audit(event,data){ try{ this.audit?.append(event,data); }catch{} }

  importBuffer(name, buffer, meta={}){
    if(!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('File data is required');
    const max = Math.max(1, Number(process.env.WA_MAX_MEDIA_FILE_MB || 100))*1024*1024;
    if(buffer.length > max) throw new Error('File exceeds configured media limit of '+(max/1024/1024)+' MB');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const duplicate = this.files.find(x=>x.sha256===hash);
    if(duplicate) return {...duplicate, duplicate:true};
    const ext = path.extname(safeName(name)).toLowerCase();
    const filename = Date.now()+'-'+crypto.randomBytes(4).toString('hex')+ext;
    const full = path.join(this.filesDir,filename);
    fs.writeFileSync(full,buffer,{mode:0o600});
    const row = {
      id:id('file'), name:safeName(name), storedName:filename, path:full,
      size:buffer.length, sha256:hash, extension:ext, mimeType:String(meta.mimeType||'application/octet-stream'),
      tags:Array.isArray(meta.tags)?meta.tags.map(String).slice(0,30):[],
      collection:String(meta.collection||'default').slice(0,80),
      createdAt:now(), updatedAt:now()
    };
    this.files.push(row); this._save(this.filesDb,this.files);
    this._audit('media_library_imported',{id:row.id,name:row.name,size:row.size,sha256:hash});
    return row;
  }
  listFiles(filter={}){
    let rows=this.files.slice();
    if(filter.collection) rows=rows.filter(x=>x.collection===String(filter.collection));
    if(filter.tag) rows=rows.filter(x=>x.tags.includes(String(filter.tag)));
    if(filter.q){ const q=String(filter.q).toLowerCase(); rows=rows.filter(x=>(x.name+' '+x.extension+' '+x.tags.join(' ')).toLowerCase().includes(q)); }
    return rows.map(({path,...x})=>x);
  }
  getFile(fileId){
    const row=this.files.find(x=>x.id===String(fileId));
    if(!row) throw new Error('Library file not found');
    if(!fs.existsSync(row.path)) throw new Error('Library file is missing from local storage');
    return row;
  }
  updateFile(fileId,patch={}){
    const row=this.files.find(x=>x.id===String(fileId)); if(!row) throw new Error('Library file not found');
    if(patch.name) row.name=safeName(patch.name);
    if(Array.isArray(patch.tags)) row.tags=patch.tags.map(String).slice(0,30);
    if(patch.collection!==undefined) row.collection=String(patch.collection||'default').slice(0,80);
    row.updatedAt=now(); this._save(this.filesDb,this.files); return {...row,path:undefined};
  }
  removeFile(fileId){
    const i=this.files.findIndex(x=>x.id===String(fileId)); if(i<0) return false;
    const row=this.files[i]; try{fs.unlinkSync(row.path);}catch{}
    this.files.splice(i,1); this._save(this.filesDb,this.files);
    this._audit('media_library_removed',{id:row.id,name:row.name}); return true;
  }

  createCampaign(input={}){
    const name=String(input.name||'').trim(); if(!name) throw new Error('Campaign name required');
    const accountId=String(input.accountId||'').trim(); if(!accountId) throw new Error('Account ID required');
    const fileIds=Array.isArray(input.fileIds)?[...new Set(input.fileIds.map(String))]:[];
    fileIds.forEach(x=>this.getFile(x));
    const campaign={
      id:id('campaign'), name:name.slice(0,120), accountId,
      message:String(input.message||'').slice(0,10000),
      fileIds, mode:input.mode==='individual'?'individual':'bundle',
      captionPerFile:input.captionPerFile===true,
      minDelaySeconds:Math.max(0,Number(input.minDelaySeconds||0)),
      maxDelaySeconds:Math.max(Math.max(0,Number(input.minDelaySeconds||0)),Number(input.maxDelaySeconds||0)),
      status:'draft', cursor:0, sent:0, failed:0, skipped:0, total:0,
      recipients:[], results:[], createdAt:now(), updatedAt:now(), startedAt:null, finishedAt:null
    };
    this.campaigns.push(campaign); this._save(this.campaignDb,this.campaigns);
    this._audit('broadcast_campaign_created',{campaignId:campaign.id,accountId,fileCount:fileIds.length});
    return campaign;
  }
  getCampaign(idValue){ const c=this.campaigns.find(x=>x.id===String(idValue)); if(!c) throw new Error('Campaign not found'); return c; }
  listCampaigns(){ return this.campaigns.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); }
  dryRun(idValue, contacts){
    const c=this.getCampaign(idValue);
    const eligible=[]; const skipped=[];
    for(const raw of Array.isArray(contacts)?contacts:[]){
      const phone=this.policy.normalizePhone(raw.phone);
      if(!phone || raw.consent!==true || raw.optOut===true || raw.status==='suppressed'){ skipped.push({phone:phone||raw.phone||'',reason:'consent_or_invalid'}); continue; }
      eligible.push({...raw,phone});
    }
    const files=c.fileIds.map(x=>this.getFile(x));
    const bytes=files.reduce((n,x)=>n+x.size,0);
    return {campaignId:c.id,eligibleCount:eligible.length,skippedCount:skipped.length,skipped:skipped.slice(0,100),fileCount:files.length,totalBytes:bytes,estimatedOperations:eligible.length*files.length,files:files.map(({path,...x})=>x)};
  }
  _persistCampaign(c){ c.updatedAt=now(); this._save(this.campaignDb,this.campaigns); }
  pause(idValue){ const c=this.getCampaign(idValue); c.status='paused'; this._persistCampaign(c); return c; }
  stop(idValue){ const c=this.getCampaign(idValue); c.status='stopped'; this._persistCampaign(c); return c; }

  async startCampaign(idValue, contacts, sendFile, events={}){
    const c=this.getCampaign(idValue);
    if(!['draft','paused','failed'].includes(c.status)) throw new Error('Campaign cannot be started from status '+c.status);
    const eligible=(Array.isArray(contacts)?contacts:[]).map(x=>({...x,phone:this.policy.normalizePhone(x.phone)}))
      .filter(x=>x.phone && x.consent===true && x.optOut!==true && x.status!=='suppressed');
    const files=c.fileIds.map(x=>this.getFile(x));
    if(!files.length && !c.message.trim()) throw new Error('Campaign requires a message or at least one file');
    c.recipients=eligible.map(x=>x.phone);
    c.total=eligible.length; c.status='running'; c.startedAt=c.startedAt||now(); c.finishedAt=null;
    this._persistCampaign(c);
    this.jobs.set(c.id,{stopped:false});
    events.onProgress?.({...c});
    for(let i=Math.max(0,c.cursor||0); i<eligible.length; i++){
      if(c.status==='paused'||c.status==='stopped') break;
      const contact=eligible[i];
      try{
        if(c.message.trim() && (c.mode==='bundle'||!files.length)){
          await sendFile({type:'text',contact,body:this._template(c.message,contact)});
        }
        if(c.mode==='bundle'){
          for(const f of files){
            await sendFile({type:'file',contact,file:f,caption:c.captionPerFile?this._template(c.message,contact):''});
          }
        } else {
          for(const f of files){
            await sendFile({type:'file',contact,file:f,caption:this._template(c.message,contact)});
          }
        }
        c.sent++; c.cursor=i+1; c.results[i]={phone:contact.phone,status:'sent',at:now()};
      }catch(e){
        c.failed++; c.cursor=i+1; c.results[i]={phone:contact.phone,status:'failed',error:String(e.message||e),at:now()};
      }
      this._persistCampaign(c); events.onProgress?.({...c});
      const min=Math.max(0,Number(c.minDelaySeconds)||0), max=Math.max(min,Number(c.maxDelaySeconds)||min);
      if(i+1<eligible.length && max>0) await new Promise(r=>setTimeout(r,Math.floor((min+Math.random()*(max-min))*1000)));
    }
    if(c.status==='running'){ c.status='completed'; c.finishedAt=now(); }
    this._persistCampaign(c); this.jobs.delete(c.id); events.onDone?.({...c});
    this._audit('broadcast_campaign_completed',{campaignId:c.id,status:c.status,sent:c.sent,failed:c.failed,total:c.total});
    return c;
  }
  _template(text,contact){ return String(text||'').replace(/\{name\}/gi,String(contact.name||'')).replace(/\{phone\}/gi,String(contact.phone||'')); }

  listProducts(){ return this.products.slice(); }
  upsertProduct(input={}){
    const sku=String(input.sku||'').trim().slice(0,80); if(!sku) throw new Error('SKU required');
    let row=this.products.find(x=>x.sku===sku);
    if(!row){ row={id:id('product'),sku,createdAt:now()}; this.products.push(row); }
    Object.assign(row,{name:String(input.name||row.name||sku).slice(0,200),category:String(input.category||row.category||'').slice(0,100),price:input.price??row.price??null,currency:String(input.currency||row.currency||'').slice(0,10),description:String(input.description||row.description||'').slice(0,5000),fileIds:Array.isArray(input.fileIds)?input.fileIds.map(String):row.fileIds||[],tags:Array.isArray(input.tags)?input.tags.map(String):row.tags||[],updatedAt:now()});
    row.fileIds.forEach(x=>this.getFile(x));
    this._save(this.productDb,this.products); return row;
  }
  removeProduct(sku){ const i=this.products.findIndex(x=>x.sku===String(sku)); if(i<0)return false; this.products.splice(i,1); this._save(this.productDb,this.products); return true; }

  listTickets(){ return this.tickets.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))); }
  upsertTicket(input={}){
    let row=input.id?this.tickets.find(x=>x.id===String(input.id)):null;
    if(!row){row={id:id('ticket'),createdAt:now()};this.tickets.push(row);}
    Object.assign(row,{contactId:String(input.contactId||row.contactId||''),subject:String(input.subject||row.subject||'').slice(0,200),status:String(input.status||row.status||'open'),priority:String(input.priority||row.priority||'normal'),assignee:String(input.assignee||row.assignee||''),notes:String(input.notes||row.notes||'').slice(0,10000),updatedAt:now()});
    this._save(this.ticketDb,this.tickets); return row;
  }
}
module.exports={OperationsSuite};
