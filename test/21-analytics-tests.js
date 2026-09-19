'use strict';
const assert=require('assert');
const {AnalyticsEngine,pct,bucket}=require('../src/33-analytics-engine');
assert.equal(pct(25,100),25);
assert.equal(pct(0,0),0);
assert.equal(bucket('2026-01-02T13:14:15Z','day'),'2026-01-02');
const collector={summary:()=>({messages:12,chats:3})};
const delivery={list:()=>[
 {accountId:'a',status:'acknowledged'},{accountId:'a',status:'failed'},{accountId:'b',status:'sent'}
]};
const audit={read:()=>[
 {timestamp:'2026-01-02T10:00:00Z',event:'account_ready'},
 {timestamp:'2026-01-02T11:00:00Z',event:'message_ack'}
]};
const inbox={list:()=>[
 {status:'open',priority:'urgent'},{status:'resolved',priority:'normal'}
]};
const operations={listCampaigns:()=>[
 {status:'completed'},{status:'running'},{status:'failed'}
]};
const e=new AnalyticsEngine({collector,delivery,audit,inbox,operations});
const o=e.overview();
assert.equal(o.data.messages,12);
assert.equal(o.delivery.total,3);
assert.equal(o.delivery.acknowledged,1);
assert.equal(o.inbox.urgent,1);
assert.equal(o.campaigns.completed,1);
assert.equal(e.deliveryBreakdown()[0].count,1);
assert.equal(e.activityTimeline({granularity:'day'}).length,1);
assert.equal(e.accountDelivery().length,2);
assert.equal(e.exportSnapshot().version,1);
console.log('Analytics/observability tests passed.');
