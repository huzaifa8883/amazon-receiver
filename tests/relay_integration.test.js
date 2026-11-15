import test from 'node:test';
import assert from 'node:assert/strict';
import {addedCardText,makeShiftRecord,shiftDecision} from '../src/telemetry.js';
import {RELAY_URL,configureRelay,enqueueRelayEvent,flushRelayQueue,relayPublicStatus,testRelay} from '../src/relay.js';
const local=new Map();const alarms=[];
globalThis.chrome={storage:{local:{
  async get(keys){const requested=Array.isArray(keys)?keys:[keys];const out={};for(const k of requested)out[k]=local.get(k);return out;},
  async set(items){for(const [k,v] of Object.entries(items))local.set(k,v);}
}},alarms:{async create(name,opts){alarms.push({name,...opts});},async clear(name){return true;}}};
function reset(){local.clear();alarms.length=0;}
const later=()=>new Promise(r=>setTimeout(r,20));
test('added text permits changed version without reattempting unchanged formatting or mileage',()=>{
  assert.equal(addedCardText('Warehouse Associate Type: Reduced | Within 0.1 mi Poole','Warehouse Associate Type: Reduced | Within 0.4 mi Poole'),'');
  assert.equal(addedCardText('Warehouse Associate Type: Reduced | Poole','Warehouse Associate Type: Reduced Part Time | Poole'),'part time');
  assert.equal(addedCardText('Part Time Warehouse Poole','Part Time Warehouse Poole'),'');
});
test('each shift record contains original visible card, dates, times, hours, pay, location and correct reasons',()=>{
  const c=makeShiftRecord({key:'one',text:'Warehouse Associate Start date: 16 Nov 2026 End date: 16 Jan 2027 Shift: Mon–Fri 07:00–13:30 Hours: 30 hours/week Pay: £16.10/hr Location: BS35 4BR',weeklyHours:30,workingDays:5,startTime:'07:00'},'visit-1',{job_id:'job-1',title:'Warehouse Associate',location:'Bristol'});
  assert.equal(c.start_date,'16 Nov 2026');assert.equal(c.end_date,'16 Jan 2027');assert.equal(c.weekly_hours,30);
  assert.equal(c.location,'BS35 4BR');assert.match(c.original_text,/Mon–Fri/);
  assert.equal(shiftDecision(c,{minHours:10,maxHours:15,days:5,daysMode:'required'}).eligible,false);
});
test('config is saved locally and no API key is included in public status',async()=>{
  reset();await configureRelay({enabled:false,apiKey:'private-test-key'});
  const s=await relayPublicStatus();assert.equal(s.configured,true);assert.equal(s.enabled,false);
  assert.equal(JSON.stringify(s).includes('private-test-key'),false);
});
test('pending event persists and 202 removes it; bearer key stays in headers only',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  // Simulate an offline relay until the later explicit flush.
  globalThis.fetch=async()=>{throw Error('offline')};
  const id=await enqueueRelayEvent('job_selected',{job_id:'123',title:'Warehouse Associate',location:'Poole',password:'DO_NOT_SEND'});
  assert.equal((await relayPublicStatus()).pending,1);
  globalThis.fetch=async(url,args)=>{
    assert.equal(url,RELAY_URL);assert.equal(args.headers.Authorization,'Bearer secret');
    const event=JSON.parse(args.body);assert.equal(event.event_id,id);assert.equal(event.event_type,'job_selected');
    assert.equal(event.data.password,undefined);assert.equal(args.body.includes('secret'),false);
    return {status:202,headers:new Headers()};
  };
  // Bypass the retry backoff in the test after connectivity returns.
  const q=local.get('relayPending');q[0].nextAt=Date.now()-1;local.set('relayPending',q);
  await flushRelayQueue();
  assert.equal((await relayPublicStatus()).pending,0);
});
test('429 schedules retries retaining same UUID, without dropping the event',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  const seen=[];globalThis.fetch=async(_url,args)=>{seen.push(JSON.parse(args.body).event_id);return {status:429,headers:new Headers({'Retry-After':'60'})};};
  const id=await enqueueRelayEvent('automation_error',{stage:'shift',error:'stuck'});
  await later();
  assert.equal((await relayPublicStatus()).pending,1);
  assert.deepEqual(seen,[id]);assert.equal(alarms.some(a=>a.name==='relay-flush'),true);
});
test('422 is reported and removed as non-retryable, not resent indefinitely',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  globalThis.fetch=async()=>({status:422,headers:new Headers()});
  await enqueueRelayEvent('shift_visit_completed',{visit_id:'x',cards:[]});await later();
  const status=await relayPublicStatus();assert.equal(status.pending,0);assert.match(status.lastResult,/422/);
});

test('disabled relay creates no local job/shift history',async()=>{
  reset();await configureRelay({enabled:false,apiKey:'secret'});
  const id=await enqueueRelayEvent('shift_card_detected',{original_text:'Warehouse shift'});
  assert.equal(id,null);assert.equal((await relayPublicStatus()).pending,0);
});

test('test button sends strict automation_stopped payload and waits for HTTP 202',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  let sent=0;
  globalThis.fetch=async(url,args)=>{
    sent++;
    assert.equal(url,RELAY_URL);
    assert.equal(args.headers.Authorization,'Bearer secret');
    const body=JSON.parse(args.body);
    assert.equal(body.event_type,'automation_stopped');
    assert.match(body.event_id,/^[a-f0-9-]{36}$/i);
    assert.equal(new Date(body.occurred_at).toISOString(),body.occurred_at);
    assert.equal(body.data.stage,'relay_test');
    assert.match(body.data.reason,/^TEST ONLY - Telegram connection check/);
    assert.match(body.data.reason,/Test ID: [a-f0-9-]{36}/i);
    assert.match(body.data.reason,/Clicked: 20\d{2}-/);
    assert.deepEqual(Object.keys(body.data).sort(),['reason','stage']);
    assert.deepEqual(Object.keys(body).sort(),['data','event_id','event_type','occurred_at']);
    return {status:202,headers:new Headers()};
  };
  const result=await testRelay();
  assert.equal(result.ok,true);assert.equal(result.httpStatus,202);
  assert.equal((await relayPublicStatus()).pending,0);
  assert.equal(sent,1);
});
test('test button reports real HTTP 422 rather than claiming successful queue',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  globalThis.fetch=async()=>({status:422,headers:new Headers(),text:async()=>JSON.stringify({detail:'Invalid event payload or event fields'})});
  const result=await testRelay();
  assert.equal(result.ok,false);assert.equal(result.httpStatus,422);
  assert.match(result.error,/HTTP 422/);
  assert.match((await relayPublicStatus()).lastResult,/schema/);
});
test('invalid events fail locally without hitting network or leaking rejected data',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected fetch');};
  const id=await enqueueRelayEvent('job_selected',{job_id:'missing-details',title:'',location:''});
  assert.equal(id,null);assert.equal(calls,0);
  assert.equal((await relayPublicStatus()).pending,0);
  assert.match((await relayPublicStatus()).lastResult,/missing required title/);
});

test('each repeated manual test click creates a fresh payload fingerprint even inside 120 seconds',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  const posted=[];
  globalThis.fetch=async(_url,args)=>{
    posted.push(JSON.parse(args.body));
    return {status:202,headers:new Headers(),text:async()=>JSON.stringify({status:'queued'})};
  };
  const a=await testRelay({state:'stopped',stage:'idle'});
  const b=await testRelay({state:'running',stage:'shift'});
  assert.equal(a.receipt,'queued');assert.equal(b.receipt,'queued');
  assert.equal(posted.length,2);
  assert.notEqual(posted[0].event_id,posted[1].event_id);
  assert.notEqual(posted[0].data.reason,posted[1].data.reason);
  assert.match(posted[0].data.reason,/Extension: STOPPED \| Stage: idle/);
  assert.match(posted[1].data.reason,/Extension: RUNNING \| Stage: shift/);
  assert.equal(posted[0].event_type,'automation_stopped');
  assert.equal(posted[1].data.stage,'relay_test');
});
test('test acceptance accurately distinguishes 202 duplicate from 202 queued',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  globalThis.fetch=async()=>({status:202,headers:new Headers(),text:async()=>JSON.stringify({status:'duplicate'})});
  const duplicate=await testRelay();
  assert.equal(duplicate.receipt,'duplicate');
  assert.match((await relayPublicStatus()).lastResult,/duplicate/i);
  globalThis.fetch=async()=>({status:202,headers:new Headers(),text:async()=>JSON.stringify({status:'queued'})});
  const queued=await testRelay();
  assert.equal(queued.receipt,'queued');
  assert.match((await relayPublicStatus()).lastResult,/Test queued/);
});
test('unsupported status heartbeat gets one 422 and pauses subsequent periodic reports, not other events',async()=>{
  reset();await configureRelay({enabled:true,apiKey:'secret'});
  local.set('relayStatusEnabled',true);
  globalThis.fetch=async()=>({status:422,headers:new Headers(),text:async()=>JSON.stringify({detail:'Invalid event payload'})});
  await enqueueRelayEvent('automation_status',{state:'running',stage:'shift',detail:'Reading cards'});
  await later();
  assert.equal(local.get('relayStatusEnabled'),false);
  assert.equal((await relayPublicStatus()).pending,0);
  assert.match((await relayPublicStatus()).lastResult,/compatibility patch/i);
});

test('one consolidated shift visit report includes all rejected cards and original text',async()=>{
  const {shiftVisitReport}=await import('../src/telemetry.js');
  const {buildRelayEvent}=await import('../src/relay_schema.js');
  const cards=[
    {key:'shift-a',weekly_hours:16,shift_days:'Sat Sun Mon Tue 16:00 - 20:00',location:'Poole BH15 2AA',original_text:'Start date: 14 Nov 2026 End date: 16 Jan 2027 Shift: Sat Sun Mon Tue 16:00 - 20:00 Hours: 16 per week',decision:'rejected',rejection_reasons:['Weekly hours outside 10–12']},
    {key:'shift-b',weekly_hours:39,shift_days:'Sun Mon 04:00 - 14:15',location:'Poole BH15 2AA',original_text:'Shift: Sun Mon 04:00 - 14:15 Hours: 39 per week',decision:'rejected',rejection_reasons:['Weekly hours outside 10–12']}
  ];
  const report=shiftVisitReport({visit_id:'visit-12345',job:{job_id:'job-12345',title:'Delivery Station Warehouse Associate'},cards},'No qualifying shift meets configured preferences');
  assert.equal(report.type,'shift_visit_completed');
  const event=buildRelayEvent(report.type,report.data);
  assert.equal(event.event_type,'shift_visit_completed');
  assert.equal(event.data.cards.length,2);
  assert.deepEqual(event.data.cards.map(c=>c.decision),['rejected','rejected']);
  assert.match(event.data.cards[0].original_shift_card_text,/14 Nov 2026/);
  assert.match(event.data.cards[1].rejection_reason,/10–12/);
  assert.match(event.data.summary,/No qualifying shift/);
});

test('zero cards emits one complete visit report without an extra no-shift event',async()=>{
  const {shiftVisitReport}=await import('../src/telemetry.js');
  const {buildRelayEvent}=await import('../src/relay_schema.js');
  const r=shiftVisitReport({visit_id:'visit-empty1',job:{job_id:'job-p'},cards:[]},'Amazon no-available-shifts page');
  assert.equal(r.type,'shift_visit_completed');
  assert.deepEqual(buildRelayEvent(r.type,r.data).data.cards,[]);
  assert.match(r.data.summary,/No shift cards available/);
});
