'use strict';
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');

class SecretStore{
  constructor(file, options={}){
    this.file=path.resolve(file);
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    this.keyFile=options.keyFile||path.join(path.dirname(this.file),'secret-store.key');
    this.masterKey=options.masterKey||process.env.WA_MASTER_KEY||this._loadLocalKey();
  }
  _loadLocalKey(){
    try{const value=fs.readFileSync(this.keyFile,'utf8').trim();if(value)return value}catch{}
    const value=crypto.randomBytes(32).toString('hex');
    try{fs.writeFileSync(this.keyFile,value+'\\n',{mode:0o600})}catch{}
    return value;
  }
  _key(){
    if(!this.masterKey)return null;
    return crypto.createHash('sha256').update(String(this.masterKey)).digest();
  }
  set(id,value){
    const key=this._key(); if(!key) return false;
    const iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const data=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
    const row={id:String(id),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64'),updatedAt:new Date().toISOString()};
    let rows=[]; try{rows=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(rows))rows=[];}catch{}
    const i=rows.findIndex(x=>x.id===row.id); if(i>=0)rows[i]=row; else rows.push(row);
    const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now(); fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n'); fs.renameSync(tmp,this.file);
    return true;
  }
  get(id){
    const key=this._key(); if(!key)return null;
    let rows=[]; try{rows=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return null;}
    const row=rows.find(x=>x.id===String(id)); if(!row)return null;
    try{
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv,'base64'));
      decipher.setAuthTag(Buffer.from(row.tag,'base64'));
      return Buffer.concat([decipher.update(Buffer.from(row.data,'base64')),decipher.final()]).toString('utf8');
    }catch{return null;}
  }
  remove(id){
    let rows=[]; try{rows=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return false;}
    const next=rows.filter(x=>x.id!==String(id)); if(next.length===rows.length)return false;
    const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now(); fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n'); fs.renameSync(tmp,this.file); return true;
  }
}
module.exports={SecretStore};