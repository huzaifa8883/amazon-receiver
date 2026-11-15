import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,clone} from '../src/rules.js';
const events={};const eventType=k=>({addListener:f=>events[k]=f});
const store={session:{},local:{settings:{...clone(DEFAULTS),refreshMode:'oracle',shifts:{...clone(DEFAULTS.shifts),minHours:10,maxHours:15}},oracleReceiverConfig:{endpoint:'wss://oracle.example.org/v1/signals',receiverId:'receiver-01',credential:'separate-device-secret-123'}}};
const tabs=new Map([[11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'}]]);
const reloaded=[],clicked=[],alarms=[];let offscreen=false;
const get=(area,key)=>Array.isArray(key)?Object.fromEntries(key.map(k=>[store[area][k],store[area][k]])):({[key]:store[area][key]});
globalThis.chrome={
  runtime:{id:'receiver-test',getURL:x=>'chrome-extension://receiver-test/'+x,onMessage:eventType('message'),onInstalled:eventType('installed'),onStartup:eventType('startup'),
    sendMessage:async m=>m.type==='ORACLE_SIGNAL_CONNECT'?{ok:true}:m.type==='ORACLE_SIGNAL_PING'?{ok:true,status:{configured:true}}:m.type==='ORACLE_SIGNAL_DISCONNECT'?{ok:true}:{ok:true}},
  storage:{local:{get:async k=>{if(Array.isArray(k))return Object.fromEntries(k.map(x=>[x,store.local[x]]));return {[k]:store.local[k]};},set:async x=>Object.assign(store.local,x),remove:async k=>delete store.local[k]},
    session:{get:async k=>{if(Array.isArray(k))return Object.fromEntries(k.map(x=>[x,store.session[x]]));return {[k]:store.session[k]};},set:async x=>Object.assign(store.session,x),clear:async()=>Object.keys(store.session).forEach(k=>delete store.session[k]),remove:async k=>delete store.session[k]}},
  tabs:{onCreated:eventType('created'),onUpdated:eventType('updated'),onRemoved:eventType('removed'),
    query:async filter=>filter.active?[tabs.get(11)]:[tabs.get(11)],get:async id=>tabs.get(id)??Promise.reject(Error('missing tab')),
    sendMessage:async (id,m)=>{if(m.type==='CLICK')clicked.push([id,m.label]);if(m.type==='SECURITY_STATUS')return {ok:true,blocked:false};return {ok:true}},
    reload:async id=>{reloaded.push(id)},update:async (id,ch)=>Object.assign(tabs.get(id),ch),create:async ({url})=>{throw Error('unexpected duplicate tab '+url)},remove:async id=>tabs.delete(id)},
  alarms:{onAlarm:eventType('alarm'),create:async (k,c)=>alarms.push([k,c]),clear:async ()=>true,get:async()=>null,clearAll:async()=>{}},
  scripting:{executeScript:async()=>{}},
  offscreen:{hasDocument:async()=>offscreen,closeDocument:async()=>{offscreen=false},createDocument:async()=>{offscreen=true}}
};
await import('../src/background.js');
const send=(m,tab=11,url)=>new Promise((resolve,reject)=>{try{events.message(m,{tab:{id:tab},url},resolve);}catch(e){reject(e);}});
const command=command=>send({type:'COMMAND',command});
const signal=id=>({type:'new_job_detected',event_id:id,job_id:'JOB-UK-1',detected_at:new Date().toISOString(),detector_id:'detector-01'});
const recv=id=>send({type:'ORACLE_SIGNAL_EVENT',signal:signal(id)},undefined,chrome.runtime.getURL('offscreen.html'));
const resultSnapshot=(cards=[])=>({url:tabs.get(11).url,isSearch:true,activeRecommended:'yes',jobCards:cards,buttons:{},loading:false,securityBlocked:false,loginRequired:false,noShifts:false});
test('Oracle mode waits without creating a scheduled search-refresh alarm',async()=>{
  const r=await command('START');assert.equal(r.ok,true);
  assert.equal(store.session.session.status,'WAITING FOR ORACLE SIGNAL');
  assert.equal(store.session.session.signalCycleActive,false);
  assert.equal(store.session.session.nextRefresh,null);
  assert.equal(reloaded.length,0);
  assert.equal(alarms.filter(x=>x[0]==='job-refresh').length,0);
});
test('no card is clicked while waiting even when visible',async()=>{
  await send({type:'OBSERVATION',snapshot:resultSnapshot([{id:'a',key:'job',title:'Poole',text:'Poole',locationText:'Poole'}])});
  assert.equal(clicked.length,0);
});
test('one authenticated signal starts one refresh cycle, duplicate does not reload',async()=>{
  const a='signal-unique-A';
  const unauth=await send({type:'ORACLE_SIGNAL_EVENT',signal:signal('bad-source')},11,'https://jobsatamazon.co.uk');
  assert.equal(unauth.ok,false);
  const r=await recv(a);assert.equal(r.ok,true);
  // The durable local receipt now returns before the independent refresh.
  await command('STATUS');
  assert.equal(reloaded.length,1);
  assert.equal(store.session.session.signalAwaitingReload,true);
  const duplicate=await recv(a);assert.equal(duplicate.duplicate,true);
  assert.equal(reloaded.length,1);
});
test('receiver audit correlates accepted signal without changing the existing Telegram relay',async()=>{
  const audit=await command('ORACLE_AUDIT_STATUS');
  assert.equal(audit.ok,true);
  assert(audit.audit.count>0,'receiver should have locally persisted signal lifecycle records');
  assert.equal(audit.audit.upload_enabled,false);
  const events=(store.local.oracleReceiverAuditV1?.records||[]);
  assert(events.some(x=>x.event_type==='signal_persisted'&&x.signal_id==='signal-unique-A'));
  assert(events.some(x=>x.event_type==='signal_processing_started'&&x.signal_id==='signal-unique-A'));
});
test('old page snapshots cannot click before signal-triggered reload is complete',async()=>{
  await send({type:'OBSERVATION',snapshot:resultSnapshot([{id:'a',key:'job-new',text:'Poole',title:'Job',locationText:'Poole'}])});
  assert.equal(clicked.length,0);
  await events.updated(11,{status:'complete'},tabs.get(11));
  await command('STATUS');
  assert.equal(store.session.session.signalAwaitingReload,false);
});
test('busy receiver queues a new signal without refreshing or interrupting',async()=>{
  store.session.session.phase='shift';store.session.session.appTabId=22;
  const r=await recv('signal-unique-B');assert.equal(r.ok,true);
  assert.equal(store.session.session.pendingSignals.length,1);
  assert.equal(reloaded.length,1);
});
test('cycle exhausted returns to waiting and automatically starts next queued signal',async()=>{
  const s=store.session.session;
  s.phase='search';s.appTabId=null;s.signalAwaitingReload=false;
  s.triedKeys=['job-1'];
  const card={id:'card',key:'job-1',title:'Poole',locationText:'Poole',text:'Poole Warehouse Associate',order:0};
  await send({type:'OBSERVATION',snapshot:resultSnapshot([card])});
  assert.equal(reloaded.length,1);
  store.session.session.cycleEmptyAt=Date.now()-1700;
  await send({type:'OBSERVATION',snapshot:resultSnapshot([card])});
  assert.equal(reloaded.length,2);
  assert.equal(store.session.session.activeSignalId,'signal-unique-B');
  assert.deepEqual(store.session.session.triedKeys,[]);
});
test('another new signal can reconsider historically rejected jobs',async()=>{
  const s=store.session.session;
  assert.equal(s.signalCycleActive,true);
  assert.equal(s.triedKeys.length,0);
  assert.equal((store.local.oracleSeenSignalIds||[]).length,2);
});
test('STOP prevents any future Oracle signal-triggered action',async()=>{
  const st=await command('STOP');assert.equal(st.ok,true);
  const before=reloaded.length;
  const r=await recv('signal-unique-C');assert.equal(r.ok,false);
  assert.equal(reloaded.length,before);
});
test('switch to built-in scheduler does not accept Oracle signals',async()=>{
  store.local.settings.refreshMode='builtin';
  const s=await command('SETTINGS_SAVED');assert.equal(s.ok,true);
  const r=await recv('signal-unique-D');assert.equal(r.ok,false);
});

test('a busy signal is saved locally for recovery after service-worker suspension',async()=>{
  const reset=await command('RESET');assert.equal(reset.ok,true);
  store.local.settings.refreshMode='oracle';
  const started=await command('START');assert.equal(started.ok,true);
  const s=store.session.session;s.phase='shift';s.appTabId=22;
  const id='journal-signal-B';const result=await recv(id);
  assert.equal(result.ok,true);
  assert(store.local.oracleSignalJournal.pending.some(x=>x.event_id===id));
  assert.equal(store.local.oracleSignalJournal.active,null);
  assert.equal(reloaded.filter(x=>x===11).length,2,'queued event must not refresh an active application');
});

test('Oracle authenticated test is read-only and mode changes during an application are rejected',async()=>{
  const before=reloaded.length;
  const testResult=await command('ORACLE_SIGNAL_TEST');
  assert.equal(testResult.ok,true);
  assert.equal(reloaded.length,before);
  store.local.settings.refreshMode='builtin';
  const switched=await command('SETTINGS_SAVED');
  assert.equal(switched.ok,false);
  assert.match(switched.error,/before switching refresh modes/);
  assert.equal(store.session.session.config.refreshMode,'oracle');
  store.local.settings.refreshMode='oracle';
});

test('Option A: reaching visible prehire stops Receiver Mode, retains private completion and blocks pending signals',async()=>{
  const s=store.session.session;s.phase='prehire';s.appTabId=22;
  s.currentJobKey='JOB-COMPLETE';s.currentJobTitle='Warehouse Associate';s.currentJobLocation='Poole';
  s.activeSignalData=signal('success-original');s.activeSignalId='success-original';s.signalCycleActive=true;
  const before=reloaded.length;
  const observation={url:'https://hiring.amazon.com/app?stage=prehire',isSearch:false,hostname:'hiring.amazon.com',
    buttons:{},shiftCards:[],jobCards:[],prehire:true,loading:false,securityBlocked:false,loginRequired:false};
  const result=await send({type:'OBSERVATION',snapshot:observation},22);
  assert.equal(result.ok,true);
  assert.equal(store.session.session.running,false);
  assert.equal(store.session.session.status,'Completed');
  assert.equal(store.local.oracleSignalJournal.active,null);
  assert((store.local.oracleCompletedJobs||[]).includes('JOB-COMPLETE'));
  const status=await command('ORACLE_SIGNAL_STATUS');
  assert.equal(status.receiver.receiverState,'SUCCESS_STOPPED');
  const blocked=await recv('success-new-signal');
  assert.equal(blocked.ok,false);
  assert.equal(reloaded.length,before,'No automatic search after successful prehire');
});

test('browser restart preserves pending signal but waits for authenticated connection',async()=>{
  store.local.settings.refreshMode='oracle';
  const waiting={...signal('restored-signal'),receivedAt:Date.now()};
  store.local.oracleSignalJournal={pending:[waiting],active:null};
  await chrome.storage.session.clear();
  const before=reloaded.length;
  const startResult=await command('START');
  assert.equal(startResult.ok,true);
  assert.equal(store.session.session.pendingSignals.length,1);
  assert.equal(reloaded.length,before,'no search refresh before restored signal is authenticated');
  const connected=await send({type:'ORACLE_SIGNAL_STATE',status:{state:'connected',connected:true}},undefined,chrome.runtime.getURL('offscreen.html'));
  assert.equal(connected.ok,true);
  assert.equal(reloaded.length,before+1);
  assert.equal(store.session.session.activeSignalId,'restored-signal');
  assert.equal(store.local.oracleSignalJournal.active.event_id,'restored-signal');
});

test('browser restart never silently replays an interrupted application',async()=>{
  store.local.settings.refreshMode='oracle';
  store.local.oracleSignalJournal={pending:[],active:signal('interrupted-application')};
  await chrome.storage.session.clear();
  const before=reloaded.length;
  const result=await command('START');
  assert.equal(result.ok,false);
  assert.match(result.error,/interrupted.*Reset/);
  assert.equal(reloaded.length,before);
  const reset=await command('RESET');
  assert.equal(reset.ok,true);
  assert.equal(store.local.oracleSignalJournal.active,null);
});
