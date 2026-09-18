'use strict';
const assert=require('assert');
const {PublicChannelSearch,channelRow}=require('../src/27-public-channel-search');
let n=0;
function ok(name,fn){return Promise.resolve().then(fn).then(()=>{console.log('PASS '+name);n++;});}
(async()=>{
 await ok('channel mapping',()=>{
  const r=channelRow({id:{_serialized:'123@newsletter'},name:'News',description:'Desc',isChannel:true,isReadOnly:true,timestamp:10,unreadCount:2,channelMetadata:{subscribersCount:42}});
  assert.equal(r.id,'123@newsletter');assert.equal(r.name,'News');assert.equal(r.metadata.subscriberCount,42);
 });
 await ok('public channel search options and results',async()=>{
  let seen;
  const client={searchChannels:async o=>{seen=o;return [{id:{_serialized:'a@newsletter'},name:'A',isChannel:true}]}};
  const out=await new PublicChannelSearch().search(client,{searchText:'news',countryCodes:['20','33'],limit:7,skipSubscribedNewsletters:true});
  assert.equal(seen.searchText,'news');assert.deepEqual(seen.countryCodes,['20','33']);assert.equal(seen.limit,7);assert.equal(out.count,1);
 });
 console.log('RESULT '+n+'/2 passed');
})().catch(e=>{console.error(e);process.exit(1)});
