'use strict';
const fs=require('fs');const path=require('path');
const MAX_DEFAULT=Math.max(11,Math.min(50,Number(process.env.WA_MAX_ACCOUNTS||20)));
class MultiAccountOrchestrator{
 constructor(file){this.file=path.resolve(file);fs.mkdirSync(path.dirname(this.file),{recursive:true});}
 read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}catch{return[];}}
 write(rows){const t=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(t,JSON.stringify(rows,null,2)+'\n');fs.renameSync(t,this.file);}
 capacity(liveCount){const max=Math.max(11,Math.min(100,Number(process.env.WA_MAX_ACCOUNTS||MAX_DEFAULT)));return{max,live:Number(liveCount||0),available:Math.max(0,max-Number(liveCount||0)),canCreate:Number(liveCount||0)<max};}
 listSchedules(){return this.read();}
 schedule(s){const id='sched-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);const row={id,accountId:String(s.accountId),runAt:new Date(s.runAt).toISOString(),action:s.action||'start',payload:s.payload||{},status:'scheduled',createdAt:new Date().toISOString()};if(!Number.isFinite(Date.parse(row.runAt)))throw new Error('Invalid runAt');const rows=this.read();rows.push(row);this.write(rows);return row;}
 cancel(id){const rows=this.read(),r=rows.find(x=>x.id===String(id));if(!r)return null;r.status='cancelled';r.cancelledAt=new Date().toISOString();this.write(rows);return r;}
 due(now=Date.now()){const rows=this.read(),due=[];let changed=false;for(const r of rows){if(r.status==='scheduled'&&Date.parse(r.runAt)<=now){r.status='running';r.startedAt=new Date().toISOString();due.push(r);changed=true;}}if(changed)this.write(rows);return due;}
 complete(id,status='completed',error=null){const rows=this.read(),r=rows.find(x=>x.id===String(id));if(!r)return null;r.status=status;r.finishedAt=new Date().toISOString();if(error)r.error=String(error);this.write(rows);return r;}
}
module.exports={MultiAccountOrchestrator};
