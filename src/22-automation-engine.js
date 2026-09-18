'use strict';
const {id}=require('./19-platform-store');
class AutomationEngine{
 constructor(store){this.store=store;}
 create(input){const row={id:id('auto'),name:String(input.name||'Automation'),enabled:input.enabled!==false,trigger:input.trigger||{type:'manual'},conditions:Array.isArray(input.conditions)?input.conditions:[],actions:Array.isArray(input.actions)?input.actions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};return this.store.upsert('automations',row);}
 match(row,event){return row.conditions.every(c=>{const v=event[c.field];if(c.op==='eq')return String(v)===String(c.value);if(c.op==='contains')return String(v||'').toLowerCase().includes(String(c.value||'').toLowerCase());if(c.op==='exists')return v!==undefined&&v!==null&&v!=='';return true;});}
 evaluate(event,executor){const rules=this.store.list('automations').filter(x=>x.enabled&&x.trigger?.type===event.type);const ran=[];for(const r of rules)if(this.match(r,event)){for(const action of r.actions)executor(action,event,r);ran.push(r.id);}return ran;}
}
module.exports={AutomationEngine};