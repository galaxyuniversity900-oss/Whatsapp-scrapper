'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');

const DEFAULT_MODELS=[
 ['openai','GPT','gpt-5.6-luna','chat'],['openai','GPT Pro','gpt-5.6-sol','chat'],
 ['anthropic','Claude','claude-sonnet-4','chat'],['anthropic','Claude','claude-opus-4','chat'],
 ['google','Gemini','gemini-2.5-pro','chat'],['google','Gemini Flash','gemini-2.5-flash','chat'],
 ['deepseek','DeepSeek','deepseek-chat','chat'],['deepseek','DeepSeek Reasoner','deepseek-reasoner','reasoning'],
 ['xai','Grok','grok-4','chat'],['mistral','Mistral','mistral-large-latest','chat'],
 ['meta','Llama','llama-4-maverick','chat'],['meta','Llama','llama-4-scout','chat'],
 ['qwen','Qwen','qwen3-max','chat'],['qwen','Qwen Coder','qwen3-coder','code'],
 ['cohere','Command','command-a','chat'],['perplexity','Sonar','sonar-pro','search'],
 ['groq','Llama Fast','llama-4-scout','fast'],['cerebras','Llama Fast','llama-4-scout','fast'],
 ['together','Qwen','Qwen/Qwen3-Coder','code'],['fireworks','Llama','accounts/fireworks/models/llama-4-scout-instruct-basic','chat'],
 ['nvidia','NVIDIA NIM','meta/llama-4-scout-17b-16e-instruct','chat'],['huggingface','HF Inference','meta-llama/Llama-4-Scout-17B-16E-Instruct','chat'],
 ['replicate','Hosted Model','meta/llama-4-scout','chat'],['openrouter','OpenRouter Auto','openrouter/auto','router'],
 ['openrouter','OpenRouter Free','qwen/qwen3-coder:free','code'],['openrouter','OpenRouter Gemini','google/gemini-2.5-flash','chat'],
 ['ollama','Local Llama','llama4','local'],['ollama','Local Qwen','qwen3','local'],
 ['lmstudio','Local Model','local-model','local'],['vllm','Local Server','auto','local']
].map((x,i)=>({id:'model-'+String(i+1).padStart(2,'0'),provider:x[0],label:x[1],model:x[2],task:x[3]}));

function read(file,f){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return f}}
function write(file,v){const t=file+'.tmp-'+process.pid;fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');fs.renameSync(t,file)}
function seal(value,key){
 const k=crypto.createHash('sha256').update(String(key)).digest(),iv=crypto.randomBytes(12);
 const c=crypto.createCipheriv('aes-256-gcm',k,iv),d=Buffer.concat([c.update(String(value),'utf8'),c.final()]);
 return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:d.toString('base64')};
}
function open(row,key){
 try{const k=crypto.createHash('sha256').update(String(key)).digest(),d=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(row.iv,'base64'));d.setAuthTag(Buffer.from(row.tag,'base64'));return Buffer.concat([d.update(Buffer.from(row.data,'base64')),d.final()]).toString()}catch{return null}
}
function joinUrl(base,pathPart){return String(base||'').replace(/\/$/,'')+'/'+String(pathPart||'').replace(/^\//,'')}

class AIProviderHub{
 constructor(options={}){
  this.dataDir=path.resolve(options.dataDir||path.join(process.cwd(),'.ai'));
  fs.mkdirSync(this.dataDir,{recursive:true});this.file=path.join(this.dataDir,'providers.json');
  this.key=options.masterKey||process.env.AI_MASTER_KEY||process.env.WA_MASTER_KEY||'local-ai-master-key';
 }
 models(){return DEFAULT_MODELS}
 providers(){return read(this.file,[]).map(x=>({...x,apiKey:x.apiKey?'••••••••':''}))}
 _raw(){return read(this.file,[])}
 _save(rows){write(this.file,rows)}
 upsert(input){
  const id=String(input.id||input.name||input.provider||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');
  if(!id)throw new Error('Provider id is required');
  const rows=this._raw().filter(x=>x.id!==id);
  const old=this._raw().find(x=>x.id===id);
  const row={id,name:input.name||id,provider:input.provider||'openai-compatible',
   baseUrl:String(input.baseUrl||old?.baseUrl||'').trim(),model:input.model||old?.model||'',
   enabled:input.enabled!==false,apiKey:input.apiKey?seal(input.apiKey,this.key):(old?.apiKey||null),
   headers:input.headers||old?.headers||{},createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  rows.push(row);this._save(rows);return {...row,apiKey:row.apiKey?'••••••••':''};
 }
 remove(id){this._save(this._raw().filter(x=>x.id!==String(id)));return {ok:true}}
 _get(id){const row=this._raw().find(x=>x.id===String(id));if(!row)throw new Error('AI provider not found: '+id);return row}
 async discover(id){
  const p=this._get(id);const key=p.apiKey?open(p.apiKey,this.key):'';
  const headers={'Content-Type':'application/json',...p.headers};if(key)headers.Authorization='Bearer '+key;
  const r=await fetch(joinUrl(p.baseUrl,'v1/models'),{headers});if(!r.ok)throw new Error('Model discovery HTTP '+r.status);
  const j=await r.json();return j.data||j.models||j;
 }
 async chat(id,payload={}){
  const p=this._get(id);if(!p.enabled)throw new Error('AI provider disabled');
  const key=p.apiKey?open(p.apiKey,this.key):'';
  const headers={'Content-Type':'application/json',...p.headers};if(key)headers.Authorization='Bearer '+key;
  const body={model:payload.model||p.model,messages:payload.messages||[{role:'user',content:String(payload.prompt||'')}],
   temperature:payload.temperature,max_tokens:payload.maxTokens||payload.max_tokens,stream:false};
  Object.keys(body).forEach(k=>body[k]===undefined&&delete body[k]);
  const url=payload.endpoint||joinUrl(p.baseUrl,'v1/chat/completions');
  const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();
  if(!r.ok)throw new Error('AI HTTP '+r.status+': '+text.slice(0,500));
  let j;try{j=JSON.parse(text)}catch{j={text}};
  return {provider:id,model:body.model,raw:j,text:j?.choices?.[0]?.message?.content??j?.output_text??j?.content?.[0]?.text??j?.text??'',usage:j?.usage||null};
 }
 async compare(request={}){
  const ids=Array.isArray(request.providers)?request.providers:this._raw().filter(x=>x.enabled).map(x=>x.id);
  const results=await Promise.allSettled(ids.slice(0,30).map(id=>this.chat(id,request)));
  return results.map((r,i)=>({provider:ids[i],ok:r.status==='fulfilled',result:r.status==='fulfilled'?r.value:null,error:r.status==='rejected'?String(r.reason?.message||r.reason):null}));
 }
}
module.exports={AIProviderHub,DEFAULT_MODELS};
