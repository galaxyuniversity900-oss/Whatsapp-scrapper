const fs=require('fs');const path=require('path');
class DeliveryTracker{
  constructor(file){this.file=path.resolve(file);fs.mkdirSync(path.dirname(this.file),{recursive:true})}
  _read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]}catch{return[]}}
  _write(rows){const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n','utf8');fs.renameSync(tmp,this.file)}
  create(data){const rows=this._read();const row={id:String(data.id),accountId:String(data.accountId),phone:String(data.phone),status:'send-returned',ack:null,createdAt:new Date().toISOString(),...data};rows.push(row);this._write(rows);return row}
  ack(id,ack){const rows=this._read();const i=rows.findIndex(x=>x.id===String(id));if(i<0)return false;rows[i]={...rows[i],ack,status:'acknowledged',ackAt:new Date().toISOString()};this._write(rows);return rows[i]}
  fail(id,error){const rows=this._read();const i=rows.findIndex(x=>x.id===String(id));if(i<0)return false;rows[i]={...rows[i],status:'failed',error:String(error||'unknown'),failedAt:new Date().toISOString()};this._write(rows);return rows[i]}
  list(limit=500){return this._read().slice(-Math.max(1,Number(limit)||500))}
  summary(){return this._read().reduce((a,x)=>{a.total++;a[x.status]=(a[x.status]||0)+1;return a},{total:0})}
}
module.exports={DeliveryTracker};
