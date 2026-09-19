'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {InboxEngine}=require('../src/32-inbox-engine');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wa-inbox-'));
const chats=[{id:'201@c.us',name:'Customer',lastMessageAt:'2026-09-19T10:00:00.000Z'}];
const messages=[
{id:'1',chatId:'201@c.us',chatName:'Customer',body:'Need catalog',timestamp:'2026-09-19T10:00:00.000Z',fromMe:false}
];
const collector={listChats:()=>chats,listMessages:()=>messages};
const inbox=new InboxEngine(path.join(dir,'inbox.json'),collector,{});
assert.equal(inbox.summary().total,1);
const row=inbox.list({})[0]; assert.equal(row.status,'open');
const updated=inbox.update(row.id,{status:'pending',priority:'high',assignee:'agent-1',tags:['sales']});
assert.equal(updated.status,'pending');assert.equal(updated.priority,'high');
const full=inbox.get(row.id);assert.equal(full.messages.length,1);assert.equal(full.messages[0].body,'Need catalog');
console.log('Unified inbox tests passed');
