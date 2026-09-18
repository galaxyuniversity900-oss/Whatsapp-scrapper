const fs=require('fs');const path=require('path');

function jid(v){
  if(v&&typeof v==='object'&&v._serialized)return String(v._serialized);
  return String(v||'');
}
function phoneOf(v){
  const s=jid(v);
  return s.replace(/@(c\.us|s\.whatsapp\.net|lid)$/i,'').replace(/\D/g,'');
}
function targetJid(number){
  const n=phoneOf(number);
  return n?n+'@c.us':'';
}
function unique(xs){return [...new Set((xs||[]).filter(Boolean).map(String))]}
function iso(ts){try{return ts?new Date(Number(ts)*1000).toISOString():new Date().toISOString()}catch{return new Date().toISOString()}}

class GroupIntelligence{
  constructor(file){
    this.file=path.resolve(file);
    this.reactionsFile=this.file.replace(/\.json$/,'-reactions.jsonl');
    this.eventsFile=this.file.replace(/\.json$/,'-events.jsonl');
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
  }
  read(){try{return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]}catch{return[]}}
  write(rows){const tmp=this.file+'.tmp-'+process.pid+'-'+Date.now();fs.writeFileSync(tmp,JSON.stringify(rows,null,2)+'\n','utf8');fs.renameSync(tmp,this.file)}
  append(file,row){fs.appendFileSync(file,JSON.stringify(row)+'\n','utf8')}
  recordJoin(notification,action='join'){
    const chatId=jid(notification?.chatId);
    const author=jid(notification?.author);
    const recipients=unique((notification?.recipientIds||[]).map(jid));
    if(!chatId||!recipients.length)return null;
    const row={id:jid(notification?.id)||chatId+'-'+notification?.timestamp+'-'+recipients.join(','),action,groupId:chatId,addedBy:author||null,recipients,timestamp:iso(notification?.timestamp),source:'realtime'};
    const rows=this.read();if(rows.some(x=>x.id===row.id))return row;rows.push(row);this.write(rows);return row;
  }
  recordReaction(reaction,message){
    const row={id:jid(reaction?.id)||jid(reaction?.msgId)+'-'+jid(reaction?.senderId)+'-'+String(reaction?.timestamp||Date.now()),messageId:jid(reaction?.msgId),senderId:jid(reaction?.senderId),emoji:reaction?.reaction||'',timestamp:iso(reaction?.timestamp),chatId:jid(message?.from)||jid(message?.to)||'',messageAuthor:jid(message?.author)||jid(message?.from)||null,source:'realtime'};
    if(!row.messageId||!row.senderId)return null;
    this.append(this.reactionsFile,row);return row;
  }
  async contactLabel(client,id){
    try{const c=await client.getContactById(id);return{phone:c?.number||phoneOf(id),name:c?.name||c?.pushname||'',pushname:c?.pushname||''}}catch{return{phone:phoneOf(id),name:'',pushname:''}}
  }
  async analyze(client,number,options={}){
    const target=targetJid(number);
    if(!target)throw new Error('A valid phone number is required');
    const metrics={addedBy:options.addedBy!==false,groups:options.groups!==false,messages:options.messages!==false,reactions:options.reactions!==false};
    const limit=Math.min(5000,Math.max(1,Number(options.limitMessages)||200));
    const chats=await client.getChats();
    const groups=chats.filter(c=>c?.isGroup);
    const matchedGroups=new Map();
    const additions=[];
    let messageCount=0,reactionCount=0;
    const reactionBreakdown={};
    const seenMessageIds=new Set();
    for(const group of groups){
      const groupId=jid(group.id);
      if(!groupId)continue;
      let isMember=false;
      try{isMember=(group.participants||[]).some(p=>jid(p.id)===target||phoneOf(p.id)===phoneOf(target))}catch{}
      let messages=[];
      try{messages=await group.fetchMessages({limit})}catch{}
      let groupMessages=0,groupReactions=0;
      for(const m of messages){
        const raw=m?.rawData||m?._data||{};
        const subtype=raw.subtype;
        const recipients=unique((raw.recipients||[]).map(jid));
        if(metrics.addedBy&&m?.type==='gp2'&&['add','invite','linked_group_join'].includes(subtype)&&recipients.some(x=>phoneOf(x)===phoneOf(target))){
          additions.push({groupId,groupName:group.name||'',addedBy:jid(m.author||raw.author)||null,addedByPhone:phoneOf(m.author||raw.author)||null,targetPhone:phoneOf(target),action:subtype,timestamp:iso(m.timestamp||raw.t)});
        }
        const author=jid(m.author||raw.author||m.from);
        const authoredByTarget=phoneOf(author)===phoneOf(target);
        if(authoredByTarget){
          seenMessageIds.add(jid(m.id));
          if(metrics.messages){messageCount++;groupMessages++}
          if(metrics.reactions&&m.hasReaction){
            try{
              const rs=await m.getReactions();
              for(const r of (rs||[])){
                const senders=Array.isArray(r.senders)?r.senders:[];
                reactionCount+=senders.length;groupReactions+=senders.length;
                const emoji=r.aggregateEmoji||r.id||'unknown';
                reactionBreakdown[emoji]=(reactionBreakdown[emoji]||0)+senders.length;
              }
            }catch{}
          }
        }
      }
      if(isMember||groupMessages>0||groupReactions>0||additions.some(x=>x.groupId===groupId)){
        matchedGroups.set(groupId,{id:groupId,name:group.name||'',participantCount:(group.participants||[]).length,currentMember:isMember,messages:groupMessages,reactions:groupReactions});
      }
    }
    const stored=this.read().filter(x=>x.recipients?.some(r=>phoneOf(r)===phoneOf(target)));
    for(const x of stored){
      if(metrics.addedBy){
        additions.push({groupId:x.groupId,groupName:'',addedBy:x.addedBy||null,addedByPhone:phoneOf(x.addedBy)||null,targetPhone:phoneOf(target),action:x.action,timestamp:x.timestamp});
      }
      if(!matchedGroups.has(x.groupId))matchedGroups.set(x.groupId,{id:x.groupId,name:'',participantCount:0,currentMember:false,messages:0,reactions:0});
    }
    const dedupAdditions=new Map();
    for(const x of additions){
      const k=[x.groupId,x.targetPhone,x.addedByPhone,x.action,x.timestamp].join('|');
      dedupAdditions.set(k,x);
    }
    const finalAdditions=[...dedupAdditions.values()];
    const adderIds=unique(finalAdditions.map(x=>x.addedBy).filter(Boolean));
    const adders=[];
    for(const id of adderIds){const c=await this.contactLabel(client,id);adders.push({id,phone:c.phone,name:c.name,pushname:c.pushname,groups:[...new Set(finalAdditions.filter(x=>x.addedBy===id).map(x=>x.groupId))].length,additions:finalAdditions.filter(x=>x.addedBy===id).length})}
    const result={
      targetPhone:phoneOf(target),targetId:target,
      scannedGroups:groups.length,groupsEncountered:matchedGroups.size,
      addedTimes:metrics.addedBy?finalAdditions.length:undefined,
      addedBy:metrics.addedBy?adders:undefined,
      additions:metrics.addedBy?finalAdditions:undefined,
      messageCount:metrics.messages?messageCount:undefined,
      reactionCount:metrics.reactions?reactionCount:undefined,
      reactionBreakdown:metrics.reactions?reactionBreakdown:undefined,
      groups:metrics.groups?[...matchedGroups.values()]:undefined,
      metrics,limitMessages:limit,generatedAt:new Date().toISOString()
    };
    return result;
  }
}
module.exports={GroupIntelligence,phoneOf,jid,targetJid};
