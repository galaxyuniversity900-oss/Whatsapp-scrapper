const fs=require('fs');const path=require('path');
class AccountRegistry{
  constructor(file){this.file=path.resolve(file);fs.mkdirSync(path.dirname(this.file),{recursive:true})}
  _read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]}catch{return[]}}
  _write(rows){const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n','utf8');fs.renameSync(tmp,this.file)}
  upsert(account){const rows=this._read();const id=String(account.id);const row={id,browser:account.browser||'chromium',headless:!!account.headless,enabled:account.enabled!==false,createdAt:new Date().toISOString(),...rows.find(x=>x.id===id),...account,id};const i=rows.findIndex(x=>x.id===id);if(i>=0)rows[i]=row;else rows.push(row);this._write(rows);return row}
  remove(id){const rows=this._read().filter(x=>x.id!==String(id));this._write(rows);return rows.length}
  get(id){return this._read().find(x=>x.id===String(id))||null}
  list(){return this._read()}
}
module.exports={AccountRegistry};
