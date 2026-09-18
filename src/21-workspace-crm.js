'use strict';
const {id}=require('./19-platform-store');
class WorkspaceCRM{
 constructor(store){this.store=store;}
 activity(type,data){return this.store.append('activity',{id:id('act'),type,data:data||{},createdAt:new Date().toISOString()});}
 task(input){const row={id:id('task'),title:String(input.title||''),contactId:input.contactId||null,assignedTo:input.assignedTo||null,status:input.status||'open',priority:input.priority||'normal',dueAt:input.dueAt||null,notes:String(input.notes||''),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!row.title)throw new Error('Task title required');this.activity('task.created',{taskId:row.id});return this.store.upsert('tasks',row);}
 updateTask(id,patch){const old=this.store.list('tasks').find(x=>x.id===String(id));if(!old)throw new Error('Task not found');const row={...old,...patch,id:old.id,updatedAt:new Date().toISOString()};return this.store.upsert('tasks',row);}
 pipeline(input){const row={id:id('lead'),contactId:String(input.contactId||''),stage:String(input.stage||'lead'),value:Number(input.value||0),owner:String(input.owner||''),source:String(input.source||''),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!row.contactId)throw new Error('contactId required');return this.store.upsert('leads',row);}
 customer360(contactId){const contacts=this.store.list('contacts'),c=contacts.find(x=>x.id===String(contactId));if(!c)return null;return {contact:c,tasks:this.store.list('tasks').filter(x=>x.contactId===c.id),leads:this.store.list('leads').filter(x=>x.contactId===c.id),activity:this.store.list('activity').filter(x=>x.data?.contactId===c.id||x.data?.contact===c.phone).slice(-200)};}
}
module.exports={WorkspaceCRM};