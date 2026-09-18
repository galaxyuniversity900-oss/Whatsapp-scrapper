'use strict';
const {id}=require('./19-platform-store');
class TemplateManager{
 constructor(store){this.store=store;}
 create(input){const row={id:id('tpl'),name:String(input.name||''),body:String(input.body||''),media:Array.isArray(input.media)?input.media:[],variables:Array.isArray(input.variables)?input.variables:[],version:1,active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!row.name||!row.body)throw new Error('Template name and body required');return this.store.upsert('templates',row);}
 render(t,data){return String(t.body).replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,(_,k)=>String(k.split('.').reduce((o,p)=>o?.[p],data)??''));}
 version(id,body){const t=this.store.list('templates').find(x=>x.id===String(id));if(!t)throw new Error('Template not found');t.body=String(body);t.version=(t.version||1)+1;t.updatedAt=new Date().toISOString();return this.store.upsert('templates',t);}
}
module.exports={TemplateManager};