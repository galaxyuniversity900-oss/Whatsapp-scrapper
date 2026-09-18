const fs=require('fs');const path=require('path');
class ContactStateManager{
  constructor(file,{lockTimeoutMs=10000,retryMs=50}={}){this.file=path.resolve(file);this.lockFile=this.file+'.lock';this.lockTimeoutMs=lockTimeoutMs;this.retryMs=retryMs;}
  _read(){if(!fs.existsSync(this.file))return [];const raw=fs.readFileSync(this.file,'utf8');return raw.trim()?JSON.parse(raw):[];}
  async _lock(){const started=Date.now();while(true){try{const fd=fs.openSync(this.lockFile,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));fs.closeSync(fd);return;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()-started>this.lockTimeoutMs)throw new Error('Lock timeout: '+this.lockFile);await new Promise(r=>setTimeout(r,this.retryMs));}}}
  _unlock(){try{fs.unlinkSync(this.lockFile)}catch(e){if(e.code!=='ENOENT')throw e}}
  _atomicWrite(value){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n','utf8');fs.renameSync(tmp,this.file);}
  async updateContactStatus(index,status,metadata={}){await this._lock();try{const c=this._read();if(!c[index])throw new Error('Contact index not found: '+index);c[index]={...c[index],status,...metadata};this._atomicWrite(c);return c[index];}finally{this._unlock()}}
  async batchUpdateStatuses(updates){await this._lock();try{const c=this._read();for(const u of updates){if(c[u.index])c[u.index]={...c[u.index],status:u.status,...(u.metadata||{})};}this._atomicWrite(c);return c;}finally{this._unlock()}}
  async readContacts(){return this._read()}
  async writeContacts(contacts){await this._lock();try{this._atomicWrite(contacts);return contacts}finally{this._unlock()}}
  async getStatusSummary(){const c=this._read();return {total:c.length,sent:c.filter(x=>x.status==='sent').length,failed:c.filter(x=>x.status==='failed').length,pending:c.filter(x=>x.status!=='sent'&&x.status!=='failed').length}}
}
module.exports={ContactStateManager};