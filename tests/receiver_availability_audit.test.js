import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOracleSignal,availabilityIdentity,canBeginSignalCycle,
  EXISTING_ACTIONABLE_TYPES
} from '../src/signal_rules.js';
import {
  receiverAuditRecord,compactAuditStore,createReceiverAudit,
  RECEIVER_AUDIT_KEY,ORACLE_AUDIT_UPLOAD_ENABLED,
  serializeFutureOracleAuditBatch
} from '../src/receiver_audit.js';
const now=Date.parse('2026-11-04T00:15:00.123Z');
const event=(id,more={})=>({type:'new_job_detected',event_id:id,job_id:'Plymouth-100',detector_id:'detector-01',detected_at:new Date().toISOString(),...more});
function memory(){
  const data={};let fail=false;
  return {data,get:async k=>({[k]:data[k]}),set:async o=>{if(fail){fail=false;throw Error('simulated quota failure');}Object.assign(data,o);},failNext(){fail=true;}};
}
test('existing actionable detection and change message names are accepted, unknown reappearance stays off in production',()=>{
  assert(EXISTING_ACTIONABLE_TYPES.includes('new_job_detected'));
  assert(validateOracleSignal(event('new-A')));
  assert(validateOracleSignal(event('changed-A',{type:'job_card_changed'})));
  assert(validateOracleSignal(event('changed-B',{type:'changed_job_detected'})));
  assert.equal(validateOracleSignal(event('reappear-A',{type:'job_reappeared'})),null);
  assert.equal(validateOracleSignal(event('reappear-A',{type:'job_reappeared'}),{allowFutureEpisodes:true})?.type,'job_reappeared');
});
test('same job + same content + new Oracle episode remains distinguishable from retransmission',()=>{
  const a=event('signal-A',{job_key:'job-0001',content_version:'content-01',appearance_episode:'episode-01'});
  const b=event('signal-B',{job_key:'job-0001',content_version:'content-01',appearance_episode:'episode-02'});
  const cleanA=validateOracleSignal(a),cleanB=validateOracleSignal(b);
  assert.deepEqual(availabilityIdentity(cleanA),{signal_id:'signal-A',job_key:'job-0001',content_version:'content-01',appearance_episode:'episode-01'});
  assert.deepEqual(availabilityIdentity(cleanB),{signal_id:'signal-B',job_key:'job-0001',content_version:'content-01',appearance_episode:'episode-02'});
  assert(canBeginSignalCycle({signal:cleanB,seenSignalIds:['signal-A'],completedJobKeys:[]}));
  assert.equal(canBeginSignalCycle({signal:cleanA,seenSignalIds:['signal-A']}),false);
});
test('meaningful changed card can be rechecked, previously successful application stays blocked',()=>{
  const changed=validateOracleSignal(event('signal-B',{type:'job_card_changed',job_key:'job-0001',content_version:'content-02'}));
  assert(canBeginSignalCycle({signal:changed,seenSignalIds:['signal-A']}));
  assert.equal(canBeginSignalCycle({signal:changed,seenSignalIds:['signal-A'],completedJobKeys:['job-0001']}),false);
});
test('invalid optional episode metadata is rejected rather than silently reinterpreted',()=>{
  assert.equal(validateOracleSignal(event('evt-1',{appearance_episode:'bad value'})),null);
  assert.equal(validateOracleSignal(event('evt-1',{content_version:123})),null);
});
test('audit event includes millisecond UTC timestamp, signal correlation and sanitises secrets',()=>{
  const x=receiverAuditRecord('job_selected',{receiver_id:'receiver-01',signal_id:'signal-01',
    job_key:'UK-1',content_version:'v1',appearance_episode:'episode-2',phase:'shift',
    reason:'Bearer SECRET password:1234 token=abc123 user@example.com',
    visible_jobs:3,shift_count:2},now,'uuid-record-001');
  assert.equal(x.schema_version,1);
  assert.equal(x.occurred_at,'2026-11-04T00:15:00.123Z');
  assert.equal(x.event_id,'uuid-record-001');
  assert.equal(x.job_key,'UK-1');
  assert.equal(x.appearance_episode,'episode-2');
  assert(!JSON.stringify(x).includes('SECRET'));
  assert(!JSON.stringify(x).includes('abc123'));
  assert(!JSON.stringify(x).includes('user@example.com'));
  assert(!Object.hasOwn(x,'credential'));
});
test('local receiver audit persists across recorder restart, never contacts Oracle',async()=>{
  const db=memory();const one=createReceiverAudit({storage:db,now:()=>now});
  await one.record('signal_received',{signal_id:'signal-A',job_key:'Plymouth-100'}).pending;
  const two=createReceiverAudit({storage:db,now:()=>now+1000});
  await two.record('shift_visit_completed',{signal_id:'signal-A',shift_count:4}).pending;
  const snapshot=await two.status();
  assert.equal(snapshot.count,2);
  assert.equal(snapshot.upload_enabled,false);
  assert.equal(ORACLE_AUDIT_UPLOAD_ENABLED,false);
  assert.equal(db.data[RECEIVER_AUDIT_KEY].records[1].shift_count,4);
  assert.equal(Object.keys(db.data).length,1);
});
test('concurrent audit calls are serialised and records are not lost',async()=>{
  const db=memory();let tick=now;
  const log=createReceiverAudit({storage:db,now:()=>++tick,maxRecords:200});
  const actions=Array.from({length:80},(_,i)=>log.record('signal_received',{signal_id:'signal-'+i}).pending);
  await Promise.all(actions);
  assert.equal((await log.status()).count,80);
});
test('bounded audit queue reports evictions and retains newest records',async()=>{
  const db=memory();let tick=now;
  const log=createReceiverAudit({storage:db,now:()=>++tick,maxRecords:3,maxBytes:50000});
  for(let i=0;i<7;i++)await log.record('test',{signal_id:'signal-'+i}).pending;
  const status=await log.status();
  assert.equal(status.count,3);
  assert.equal(status.overflow_total,4);
  assert.deepEqual(db.data[RECEIVER_AUDIT_KEY].records.map(x=>x.signal_id),['signal-4','signal-5','signal-6']);
});
test('audit expiry is local seven days; future central 90-day retention is not claimed as deployed',()=>{
  const old=receiverAuditRecord('test',{signal_id:'old'},now-8*86400000,'old');
  const fresh=receiverAuditRecord('test',{signal_id:'fresh'},now,'fresh');
  const result=compactAuditStore({records:[old,fresh]},now);
  assert.equal(result.records.length,1);
  assert.equal(result.expired_total,1);
  assert.equal(result.upload_enabled,false);
});
test('storage quota/error does not poison the nonblocking recording queue',async()=>{
  const db=memory();const log=createReceiverAudit({storage:db,now:()=>now});
  db.failNext();
  await assert.rejects(log.record('attempt',{signal_id:'one'}).pending,/quota/);
  await log.record('attempt',{signal_id:'two'}).pending;
  assert.equal((await log.status()).count,1);
  assert.equal((await log.status()).write_failures_since_restart,1);
});
test('future serializer prepares an offline batch without inventing a production endpoint',()=>{
  const record=receiverAuditRecord('signal_received',{signal_id:'signal-A'},now,'record-1');
  const batch=serializeFutureOracleAuditBatch([record]);
  assert.equal(batch.events.length,1);
  assert.equal(batch.events[0].event_id,'record-1');
  assert.equal(batch.schema_version,1);
  assert(!Object.hasOwn(batch,'url'));
});

test('audit overload applies backpressure instead of accumulating unbounded promises',async()=>{
  const db=memory();let tick=now;
  const log=createReceiverAudit({storage:db,now:()=>++tick,maxRecords:1200});
  const requests=Array.from({length:250},(_,i)=>log.record('signal_received',{signal_id:'flood-'+i}));
  assert.equal(requests.filter(x=>x.dropped).length,50);
  await Promise.all(requests.map(x=>x.pending));
  const status=await log.status();
  assert.equal(status.count,200);
  assert.equal(status.pending_writes,0);
  assert.equal(status.dropped_pending_writes_since_restart,50);
});
