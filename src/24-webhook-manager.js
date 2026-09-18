'use strict';
const crypto=require('crypto');
const {id}=require('./19-platform-store');
class WebhookManager{
 constructor(store){this.store=store;}
 create(input){const secret=input.secret||crypto.randomBytes(24).toString('hex');return this.store.upsert('webhooks',{id:id('hook'),url:String(input.url||''),events:Array.isArray(input.events)?input.events:[],active:input.active!==false,secret,createdAt:new Date().toISOString()});}
 sign(payload,secret){return crypto.createHmac('sha256',secret).update(payload).digest('hex');}
 dispatch(event,payload,send){for(const h of this.store.list('webhooks').filter(x=>x.active&&x.events.includes(event))){const body=JSON.stringify({event,data:payload,timestamp:new Date().toISOString()});send(h,{body,signature:this.sign(body,h.secret)});}}
}
module.exports={WebhookManager};