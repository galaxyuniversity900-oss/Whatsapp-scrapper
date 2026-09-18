const fs=require('fs');const path=require('path');const EventEmitter=require('events');

function safeIso(ts){try{return ts?new Date(Number(ts)*1000).toISOString():new Date().toISOString()}catch{return new Date().toISOString()}}
function chatType(chat){if(chat?.isGroup)return'group';if(chat?.isChannel)return'channel';return'private'}
function normalizeMessage(message,chat=null){const id=message?.id?._serialized||String(message?.id||'');const from=message?.from||'';const to=message?.to||'';const author=message?.author||from;return{
  id,chatId:chat?.id?._serialized||message?.from||message?.to||'',chatType:chatType(chat),chatName:chat?.name||'',senderId:author,senderPhone:String(author).endsWith('@c.us')?String(author).replace('@c.us',''):'',senderName:message?.notifyName||'',from,to,fromMe:!!message?.fromMe,type:message?.type||'unknown',timestamp:safeIso(message?.timestamp),body:message?.body||'',hasMedia:!!message?.hasMedia,mentionedIds:Array.isArray(message?.mentionedIds)?message.mentionedIds.map(x=>typeof x==='string'?x:x?._serialized).filter(Boolean):[],quotedId:message?.hasQuotedMsg?message?._data?.quotedStanzaID||null:null
}}

class DataCollector extends EventEmitter{
  constructor(dir){super();this.dir=path.resolve(dir);this.messagesFile=path.join(this.dir,'messages.jsonl');this.chatsFile=path.join(this.dir,'chats.json');this.profilesFile=path.join(this.dir,'profiles.json');this.groupsFile=path.join(this.dir,'groups.json');this.contactsFile=path.join(this.dir,'directory.json');fs.mkdirSync(this.dir,{recursive:true});this.recent=[]}
  _readJson(file,fallback=[]){try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback}catch{return fallback}}
  _writeJson(file,value){const tmp=file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,file)}
  _append(file,row){fs.appendFileSync(file,JSON.stringify(row)+'\n','utf8')}
  ingest(message,chat){const row=normalizeMessage(message,chat);if(!row.id)return null;this._append(this.messagesFile,row);this.recent.unshift(row);this.recent=this.recent.slice(0,500);this.upsertChat({id:row.chatId,type:row.chatType,name:row.chatName,lastMessageAt:row.timestamp});this.emit('message',row);return row}
  upsertChat(chat){const rows=this._readJson(this.chatsFile,[]);const id=String(chat.id||'');if(!id)return;const i=rows.findIndex(x=>x.id===id);const row={...rows[i],...chat,id};if(i<0)rows.push(row);else rows[i]=row;this._writeJson(this.chatsFile,rows)}
  saveProfiles(rows){this._writeJson(this.profilesFile,rows);return rows}
  saveGroups(rows){this._writeJson(this.groupsFile,rows);return rows}
  saveContacts(rows){this._writeJson(this.contactsFile,rows);return rows}
  listMessages(limit=500){if(!fs.existsSync(this.messagesFile))return[];const lines=fs.readFileSync(this.messagesFile,'utf8').split(/\r?\n/).filter(Boolean);return lines.slice(-Math.max(1,Number(limit)||500)).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean).reverse()}
  listChats(){return this._readJson(this.chatsFile,[])}
  listProfiles(){return this._readJson(this.profilesFile,[])}
  listGroups(){return this._readJson(this.groupsFile,[])}
  listContacts(){return this._readJson(this.contactsFile,[])}
  summary(){return{messages:this.listMessages(100000).length,chats:this.listChats().length,profiles:this.listProfiles().length,groups:this.listGroups().length,contacts:this.listContacts().length}}
}
module.exports={DataCollector,normalizeMessage,chatType};
