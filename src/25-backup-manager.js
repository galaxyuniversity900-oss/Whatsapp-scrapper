'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
class BackupManager{
 constructor(root,store){this.root=path.resolve(root);this.store=store;fs.mkdirSync(this.root,{recursive:true});}
 create(){return this.store.backup(this.root);}
 encrypt(file,password){if(!password)throw new Error('Backup password required');const key=crypto.scryptSync(password,'wa-platform',32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=fs.readFileSync(file),out=Buffer.concat([cipher.update(data),cipher.final()]);const dest=file+'.enc';fs.writeFileSync(dest,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:out.toString('base64')}));return dest;}
}
module.exports={BackupManager};