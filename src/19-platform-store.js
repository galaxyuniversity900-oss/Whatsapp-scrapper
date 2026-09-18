'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
class PlatformStore{
  constructor(root){this.root=path.resolve(root);fs.mkdirSync(this.root,{recursive:true});}
  file(name){return path.join(this.root,name+'.json');}
  read(name,def=[]){try{const v=JSON.parse(fs.readFileSync(this.file(name),'utf8'));return v;}catch{return def;}}
  write(name,value){const f=this.file(name),tmp=f+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,f);return value;}
  list(name){return this.read(name,[]);}
  upsert(name,row,key='id'){const rows=this.list(name);const id=String(row[key]);const i=rows.findIndex(x=>String(x[key])===id);if(i>=0)rows[i]={...rows[i],...row};else rows.push(row);this.write(name,rows);return i>=0?rows[i]:row;}
  remove(name,id,key='id'){const rows=this.list(name),next=rows.filter(x=>String(x[key])!==String(id));if(next.length===rows.length)return false;this.write(name,next);return true;}
  append(name,row){const rows=this.list(name);rows.push(row);this.write(name,rows);return row;}
  snapshot(){const out={};for(const n of ['contacts','tasks','templates','segments','campaigns','automations','webhooks','activity','settings'])out[n]=this.list(n);return out;}
  backup(dir){fs.mkdirSync(dir,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=path.join(dir,'platform-backup-'+stamp+'.json');const data=JSON.stringify({version:1,createdAt:new Date().toISOString(),data:this.snapshot()},null,2);fs.writeFileSync(file,data);return file;}
}
function id(prefix){return prefix+'-'+crypto.randomBytes(7).toString('hex');}
module.exports={PlatformStore,id};