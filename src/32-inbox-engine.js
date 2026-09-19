'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const id=()=> 'conv-'+Date.now().toString(36)+'-'+crypto.randomBytes(4).toString('hex');
class InboxEngine{
  constructor(file,collector,platform){this.file=file;this.collector=collector;this.platform=platform;this.rows=this._load()}
  _load(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'))}catch{return []}}
  _save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.rows,null,2));fs.renameSync(tmp,this.file)}
  _key(chatId){return String(chatId||'')}
  sync(){
    const chats=this.collector.listChats(), messages=this.collector.listMessages(10000);
    const by=new Map(this.rows.map(x=>[x.chatId,x]));
    for(const c of chats){
      const chatId=this._key(c.id); if(!chatId)continue;
      const ms=messages.filter(m=>this._key(m.chatId)===chatId);
      const last=ms[0]||null; let row=by.get(chatId);
      if(!row)row={id:id(),chatId,status:'open',priority:'normal',assignee:'',tags:[],notes:'',createdAt:new Date().toISOString()};
      Object.assign(row,{channel:'whatsapp',chatName:c.name||last?.chatName||chatId,lastMessageAt:c.lastMessageAt||last?.timestamp||row.lastMessageAt||null,lastMessage:last?.body||row.lastMessage||'',updatedAt:new Date().toISOString()});
      by.set(chatId,row);
    }
    this.rows=[...by.values()];this._save();return this.rows;
  }
  list(filter={}){
    this.sync();let rows=this.rows.slice();
    if(filter.status&&filter.status!=='all')rows=rows.filter(x=>x.status===filter.status);
    if(filter.assignee)rows=rows.filter(x=>x.assignee===String(filter.assignee));
    if(filter.priority&&filter.priority!=='all')rows=rows.filter(x=>x.priority===filter.priority);
    if(filter.q){const q=String(filter.q).toLowerCase();rows=rows.filter(x=>(x.chatName+' '+x.chatId+' '+x.lastMessage+' '+x.tags.join(' ')).toLowerCase().includes(q))}
    return rows.sort((a,b)=>String(b.lastMessageAt||'').localeCompare(String(a.lastMessageAt||'')));
  }
  get(idValue){
    this.sync();const row=this.rows.find(x=>x.id===String(idValue));if(!row)throw new Error('Conversation not found');
    const messages=this.collector.listMessages(10000).filter(m=>this._key(m.chatId)===this._key(row.chatId)).reverse();
    return {...row,messages};
  }
  update(idValue,patch={}){
    this.sync();const row=this.rows.find(x=>x.id===String(idValue));if(!row)throw new Error('Conversation not found');
    if(['open','pending','resolved','closed'].includes(String(patch.status)))row.status=String(patch.status);
    if(['low','normal','high','urgent'].includes(String(patch.priority)))row.priority=String(patch.priority);
    if(patch.assignee!==undefined)row.assignee=String(patch.assignee||'').slice(0,120);
    if(Array.isArray(patch.tags))row.tags=[...new Set(patch.tags.map(String))].slice(0,30);
    if(patch.notes!==undefined)row.notes=String(patch.notes).slice(0,10000);
    row.updatedAt=new Date().toISOString();this._save();return row;
  }
  summary(){const rows=this.list({});return{total:rows.length,open:rows.filter(x=>x.status==='open').length,pending:rows.filter(x=>x.status==='pending').length,resolved:rows.filter(x=>x.status==='resolved').length,urgent:rows.filter(x=>x.priority==='urgent').length,unassigned:rows.filter(x=>!x.assignee).length}}
}
module.exports={InboxEngine};
