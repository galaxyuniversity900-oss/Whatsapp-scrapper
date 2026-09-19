'use strict';

function iso(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString();}
function bucket(value,granularity){
  const d=new Date(value); if(Number.isNaN(d.getTime())) return null;
  if(granularity==='hour') return d.toISOString().slice(0,13)+':00:00.000Z';
  if(granularity==='day') return d.toISOString().slice(0,10);
  return d.toISOString().slice(0,7);
}
function pct(n,d){return d?Math.round((n/d)*10000)/100:0;}

class AnalyticsEngine{
  constructor({collector=null,delivery=null,audit=null,inbox=null,operations=null}={}){
    this.collector=collector;this.delivery=delivery;this.audit=audit;this.inbox=inbox;this.operations=operations;
  }
  overview(){
    const data=this.collector?.summary?.()||{};
    const delivery=this.delivery?.list?.(100000)||[];
    const conversations=this.inbox?.list?.({})||[];
    const campaigns=this.operations?.listCampaigns?.()||[];
    const sent=delivery.filter(x=>x.status==='acknowledged'||x.status==='sent'||x.status==='send-returned').length;
    const failed=delivery.filter(x=>x.status==='failed').length;
    const resolved=conversations.filter(x=>x.status==='resolved'||x.status==='closed').length;
    return {
      generatedAt:new Date().toISOString(),
      data,
      delivery:{total:delivery.length,sent,failed,acknowledged:delivery.filter(x=>x.status==='acknowledged').length,successRate:pct(sent,delivery.length)},
      inbox:{total:conversations.length,open:conversations.filter(x=>x.status==='open').length,pending:conversations.filter(x=>x.status==='pending').length,resolved,urgent:conversations.filter(x=>x.priority==='urgent').length},
      campaigns:{total:campaigns.length,completed:campaigns.filter(x=>x.status==='completed').length,running:campaigns.filter(x=>x.status==='running').length,failed:campaigns.filter(x=>x.status==='failed').length},
      auditEvents:this.audit?.read?.(100000).length||0
    };
  }
  deliveryBreakdown(){
    const rows=this.delivery?.list?.(100000)||[];
    const by={};
    for(const x of rows){const k=String(x.status||'unknown');by[k]=(by[k]||0)+1;}
    return Object.entries(by).map(([status,count])=>({status,count,percent:pct(count,rows.length)})).sort((a,b)=>b.count-a.count);
  }
  activityTimeline({from,to,granularity='day'}={}){
    const lo=from?new Date(from).getTime():-Infinity,hi=to?new Date(to).getTime():Infinity;
    const events=(this.audit?.read?.(100000)||[]).filter(x=>{const t=new Date(x.timestamp).getTime();return t>=lo&&t<=hi;});
    const map=new Map();
    for(const e of events){const key=bucket(e.timestamp,granularity);if(!key)continue;const row=map.get(key)||{bucket:key,total:0,events:{}};row.total++;const name=String(e.event||'unknown');row.events[name]=(row.events[name]||0)+1;map.set(key,row);}
    return [...map.values()].sort((a,b)=>String(a.bucket).localeCompare(String(b.bucket)));
  }
  accountDelivery(){
    const rows=this.delivery?.list?.(100000)||[],map=new Map();
    for(const x of rows){const id=String(x.accountId||'unknown');const r=map.get(id)||{accountId:id,total:0,sent:0,failed:0,acknowledged:0};r.total++;if(x.status==='failed')r.failed++;else r.sent++;if(x.status==='acknowledged')r.acknowledged++;map.set(id,r);}
    return [...map.values()].map(x=>({...x,successRate:pct(x.sent,x.total)})).sort((a,b)=>b.total-a.total);
  }
  exportSnapshot(){return {version:1,generatedAt:new Date().toISOString(),overview:this.overview(),delivery:this.deliveryBreakdown(),accounts:this.accountDelivery(),timeline:this.activityTimeline({granularity:'day'})};}
}
module.exports={AnalyticsEngine,pct,bucket,iso};
