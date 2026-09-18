const EventEmitter=require('events');
class ParallelCampaignExecutor extends EventEmitter{
  constructor({concurrency=1,maxRetries=0,retryDelay=1000,signal=null}={}){super();this.concurrency=Math.max(1,Number(concurrency)||1);this.maxRetries=Math.max(0,Number(maxRetries)||0);this.retryDelay=Math.max(0,Number(retryDelay)||0);this.signal=signal;this.stopped=false;this.paused=false;}
  pause(){this.paused=true;this.emit('paused')}
  resume(){this.paused=false;this.emit('resumed')}
  stop(){this.stopped=true;this.paused=false;this.emit('stopped')}
  async _wait(){while(this.paused&&!this.stopped)await new Promise(r=>setTimeout(r,100));if(this.signal?.aborted||this.stopped)throw new Error('Execution stopped')}
  async _run(task,index,total){let attempt=0;while(true){await this._wait();try{const value=await task();this.emit('messageSent',{index,total,value});return {index,status:'sent',value};}catch(error){if(attempt>=this.maxRetries){this.emit('messageFailed',{index,total,error:String(error.message||error),attempt});return {index,status:'failed',error:String(error.message||error),attempt};}attempt++;const delay=this.retryDelay*Math.pow(2,attempt-1);this.emit('retrying',{index,attempt,delay,error:String(error.message||error)});await new Promise(r=>setTimeout(r,delay));}}}
  async executeWithConcurrency(tasks,onProgress){const total=tasks.length,results=new Array(total);let next=0,completed=0;const worker=async()=>{while(true){const i=next++;if(i>=total)return;results[i]=await this._run(tasks[i],i,total);completed++;const data={completed,total,percentage:total?Math.round(completed/total*100):100};this.emit('progress',data);if(onProgress)await onProgress(data);}};await Promise.all(Array.from({length:Math.min(this.concurrency,total)},worker));return results;}
  async sendMessagesParallel(items,sendFunc){this.emit('campaignStarted',{total:items.length});const results=await this.executeWithConcurrency(items.map((item,i)=>()=>sendFunc(item,i)),d=>this.emit('progress',d));this.emit('campaignCompleted',{total:items.length,results});return results;}
}
module.exports={ParallelCampaignExecutor};