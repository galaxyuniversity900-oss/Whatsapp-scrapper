const fs=require('fs');const path=require('path');
class CampaignScheduler{
 constructor(file){this.file=path.resolve(file);fs.mkdirSync(path.dirname(this.file),{recursive:true})}
 _read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]}catch{return[]}}
 _write(rows){const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n','utf8');fs.renameSync(tmp,this.file)}
 list(){return this._read()}
 add(job){if(!job||!job.id||!job.runAt)throw new Error('id and runAt are required');const rows=this._read().filter(x=>x.id!==job.id);const row={id:String(job.id),runAt:new Date(job.runAt).toISOString(),status:job.status||'scheduled',payload:job.payload||{},createdAt:new Date().toISOString()};rows.push(row);this._write(rows);return row}
 cancel(id){const rows=this._read();const i=rows.findIndex(x=>x.id===String(id));if(i<0)return false;rows[i]={...rows[i],status:'cancelled',cancelledAt:new Date().toISOString()};this._write(rows);return true}
 due(now=Date.now()){return this._read().filter(x=>x.status==='scheduled'&&Date.parse(x.runAt)<=now)}
 markRunning(id){return this._transition(id,'running','startedAt')}
 markCompleted(id){return this._transition(id,'completed','completedAt')}
 markFailed(id,error){const rows=this._read();const i=rows.findIndex(x=>x.id===String(id));if(i<0)return false;rows[i]={...rows[i],status:'failed',error:String(error||'unknown error'),failedAt:new Date().toISOString()};this._write(rows);return true}
 _transition(id,status,stamp){const rows=this._read();const i=rows.findIndex(x=>x.id===String(id));if(i<0)return false;rows[i]={...rows[i],status,[stamp]:new Date().toISOString()};this._write(rows);return rows[i]}
}
module.exports={CampaignScheduler};
