import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,clone} from '../src/rules.js';

const listeners={};
const events=(key)=>({addListener(fn){listeners[key]=fn}});
const sessionStore={};const localStore={settings:clone(DEFAULTS)};
const tabs=new Map([[11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'}],[22,{id:22,url:'https://hiring.amazon.com/app?stage=shift',status:'complete'}]]);
const clicked=[];const reloaded=[];const disabled=[];const alarmCleared=[];const securityStates=new Map();
globalThis.chrome={
  storage:{
    local:{get:async key=>Array.isArray(key)?Object.fromEntries(key.map(k=>[k,localStore[k]])):({[key]:localStore[key]}),set:async x=>Object.assign(localStore,x)},
    session:{get:async key=>({[key]:sessionStore[key]}),set:async x=>Object.assign(sessionStore,x),remove:async key=>delete sessionStore[key],clear:async()=>Object.keys(sessionStore).forEach(k=>delete sessionStore[k])}
  },
  tabs:{
    onCreated:events('tabCreated'),onUpdated:events('tabUpdated'),onRemoved:events('tabRemoved'),
    sendMessage:async (id,msg)=>{if(msg.type==='CLICK')clicked.push([id,msg.label]);if(msg.type==='DISABLE')disabled.push(id);if(msg.type==='SECURITY_STATUS')return {ok:true,blocked:!!securityStates.get(id)};return {ok:true}},
    get:async id=>{if(!tabs.has(id))throw Error('tab not found');return tabs.get(id)},
    query:async filters=>filters?.active?[tabs.get(11)].filter(Boolean):filters?.url?[tabs.get(11)].filter(Boolean):[],create:async ({url})=>{const id=90;tabs.set(id,{id,url,status:'complete'});return {id}},
    update:async(id,changes)=>{Object.assign(tabs.get(id),changes);return tabs.get(id)},
    remove:async id=>{tabs.delete(id)},reload:async id=>{reloaded.push(id)}
  },
  scripting:{executeScript:async()=>{}},
  alarms:{onAlarm:events('alarm'),clear:async name=>{alarmCleared.push(name);return true},get:async()=>null,create:async()=>{},clearAll:async()=>{}},
  runtime:{onMessage:events('message'),onInstalled:events('installed'),onStartup:events('startup'),sendMessage:async()=>{}},
  offscreen:{hasDocument:async()=>true,createDocument:async()=>{}}
};
await import('../src/background.js');
const send=(message,tabId=22)=>new Promise((resolve,reject)=>{
  try{listeners.message(message,{tab:{id:tabId}},resolve)}catch(e){reject(e)}
});
const makeSession=phase=>({running:true,generation:71,phase,phaseEntered:Date.now()-2000,
  searchTabId:11,appTabId:22,candidateTabIds:[],config:{...clone(DEFAULTS),shifts:{...clone(DEFAULTS.shifts),minHours:10,maxHours:15,days:5,daysMode:'priority'}},
  triedKeys:['job-plymouth'],currentJobKey:'job-plymouth',retryCount:0,shiftSeenAt:0,shiftLastChanged:0,shiftSignature:'',
  lastObservationAt:Date.now(),lastObservedLoading:false,lastStep2SeenAt:0,
  status:'Applying',continued:false,hasAgreed:true});
const snap=(changes={})=>({url:'https://hiring.amazon.com/app?stage=shift',hostname:'hiring.amazon.com',isSearch:false,
  buttons:{},shiftCards:[],jobCards:[],step2:false,shiftListReady:false,loading:false,securityBlocked:false,prehire:false,...changes});

test('generic Step 2 clicks Amazon Jobs logo and See all jobs when no shift qualifies, then searches again',async()=>{
  sessionStore.session=makeSession('after_start');
  const step2=snap({step2:true,shiftListReady:true,buttons:{homeLogo:'logo'},shiftCards:[{id:'c',key:'a',weeklyHours:40,workingDays:5,startTime:'08:00',order:0}]});
  await send({type:'OBSERVATION',snapshot:step2});
  assert.equal(sessionStore.session.phase,'shift');
  // Simulate the list having been visibly stable for one second.
  sessionStore.session.shiftSeenAt=Date.now()-1500;
  sessionStore.session.shiftLastChanged=Date.now()-1500;
  await send({type:'OBSERVATION',snapshot:step2});
  assert.equal(sessionStore.session.phase,'return_jobs');
  assert(clicked.some(([,label])=>label==='Click 7A — Amazon Jobs logo'));
  await send({type:'OBSERVATION',snapshot:snap({buttons:{seeAllJobs:'see'}})});
  assert.equal(sessionStore.session.phase,'return_wait');
  assert(clicked.some(([,label])=>label.includes('Click 8A')));
  await send({type:'OBSERVATION',snapshot:snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch'})});
  assert.equal(sessionStore.session.phase,'search');
  assert(sessionStore.session.triedKeys.includes('job-plymouth'));
  assert.equal(sessionStore.session.running,true);
  sessionStore.session.running=false;
});

test('blocked current-stage page waits three seconds before reload and caps retries at three',async()=>{
  tabs.set(22,{id:22,url:'https://hiring.amazon.com/app?stage=offer',status:'complete'});
  sessionStore.session=makeSession('offer');
  const countBefore=reloaded.length;
  // A tick at two seconds must not cause an application-stage refresh.
  sessionStore.session.phaseEntered=Date.now()-2000;
  await send({type:'WATCH_TICK',generation:71});
  assert.equal(reloaded.length,countBefore);
  assert.equal(sessionStore.session.retryCount,0);
  // Once the stage is actually stale for three seconds, recover it.
  sessionStore.session.phaseEntered=Date.now()-3100;
  await send({type:'WATCH_TICK',generation:71});
  assert.deepEqual(reloaded.slice(countBefore),[22]);
  assert.equal(sessionStore.session.retryCount,1);
  assert.match(sessionStore.session.status,/Recovering offer/);
  // When three recovery reloads have already failed, stop rather than loop.
  sessionStore.session.retryCount=3;
  sessionStore.session.phaseEntered=Date.now()-3100;
  sessionStore.session.lastObservationAt=Date.now();
  await send({type:'WATCH_TICK',generation:71});
  assert.equal(sessionStore.session.running,false);
  assert.match(sessionStore.session.status,/Failed after 3 retries/);
});

test('qualifying shift continues through Click 7–10 and stops at the pre-hire page',async()=>{
  tabs.set(22,{id:22,url:'https://hiring.amazon.com/app?stage=shift',status:'complete'});
  sessionStore.session=makeSession('shift');
  sessionStore.session.phaseEntered=Date.now()-400;
  await send({type:'OBSERVATION',snapshot:snap({step2:true,shiftListReady:true,
    shiftCards:[{id:'good',key:'12h',weeklyHours:12,workingDays:5,startTime:'08:00',order:0}]})});
  assert.equal(sessionStore.session.phase,'shift_detail');
  await send({type:'OBSERVATION',snapshot:snap({buttons:{selectJob:'pick'}})});
  assert.equal(sessionStore.session.phase,'offer');
  await send({type:'OBSERVATION',snapshot:snap({buttons:{acceptOffer:'accept'}})});
  assert.equal(sessionStore.session.phase,'offer_next');
  await send({type:'OBSERVATION',snapshot:snap({buttons:{next:'next'}})});
  assert.equal(sessionStore.session.phase,'prehire');
  await send({type:'OBSERVATION',snapshot:snap({prehire:true})});
  assert.equal(sessionStore.session.status,'Completed');
  assert.equal(sessionStore.session.running,false);
  for(const label of ['Click 7','Click 8','Click 9','Click 10'])
    assert(clicked.some(([,clickedLabel])=>clickedLabel.startsWith(label)),label);
});


test('Poole job card that does not navigate gets alternate click, then safe skip without page reloads',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  sessionStore.session=makeSession('job_details');
  const s=sessionStore.session;
  s.currentJobKey='job-poole';s.triedKeys=['job-poole'];
  s.currentJobTargets=['card-outer','card-title'];s.jobTargetIndex=0;
  s.phaseEntered=Date.now()-3100;
  const oldReloads=reloaded.length;
  const sameSearch={...snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',activeRecommended:'yes',
    jobCards:[{id:'card-outer',targets:['card-outer','card-title'],key:'job-poole',text:'Within 0.1 mi | Poole, England',order:0}]}),
    hostname:'www.jobsatamazon.co.uk'};
  await send({type:'OBSERVATION',snapshot:sameSearch},11);
  await send({type:'WATCH_TICK',generation:71},11);
  assert.equal(sessionStore.session.phase,'job_details');
  assert.equal(sessionStore.session.jobTargetIndex,1);
  assert(clicked.some(([,label])=>label.includes('Job card alternative')));
  assert.equal(reloaded.length,oldReloads,'Do not reload a Recommended page for inert card clicks');
  sessionStore.session.phaseEntered=Date.now()-3100;
  await send({type:'OBSERVATION',snapshot:sameSearch},11);
  await send({type:'WATCH_TICK',generation:71},11);
  assert.equal(sessionStore.session.phase,'search');
  assert.equal(sessionStore.session.running,true);
  assert(sessionStore.session.triedKeys.includes('job-poole'));
  assert.equal(reloaded.length,oldReloads);
  sessionStore.session.running=false;
});


test('missing Amazon Jobs logo recovers to owned Recommended tab after three seconds without reloading the application',async()=>{
  tabs.set(22,{id:22,url:'https://hiring.amazon.com/app?stage=shift',status:'complete'});
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  sessionStore.session=makeSession('return_logo');
  sessionStore.session.phaseEntered=Date.now()-3100;
  const before=reloaded.length;
  await send({type:'OBSERVATION',snapshot:snap({step2:true,shiftListReady:true,buttons:{}})});
  await send({type:'WATCH_TICK',generation:71});
  assert.equal(sessionStore.session.phase,'search');
  assert.equal(sessionStore.session.running,true);
  assert.deepEqual(reloaded.slice(before),[],'Do not reload the application to find a non-existent menu');
  assert(!tabs.has(22),'Unsuccessful application tab must be closed after returning');
  assert(sessionStore.session.triedKeys.includes('job-plymouth'));
  sessionStore.session.running=false;
});

test('Amazon Jobs logo navigation directly to search bypasses See all jobs',async()=>{
  tabs.set(22,{id:22,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  sessionStore.session=makeSession('return_jobs');
  const before=clicked.length;
  await send({type:'OBSERVATION',snapshot:snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch'})});
  assert.equal(sessionStore.session.phase,'search');
  assert.equal(sessionStore.session.running,true);
  assert.equal(clicked.length,before,'No unnecessary extra click after direct search navigation');
  sessionStore.session.running=false;
});


test('Reset clears failed stage, alarm and beep state, but keeps saved settings and all tabs',async()=>{
  const oldSettings=clone(localStore.settings);
  const configured={...clone(DEFAULTS),box1:{keywords:['Poole','Peterborough'],mode:'required'},
    shifts:{...clone(DEFAULTS.shifts),minHours:10,maxHours:15}};
  localStore.settings=configured;
  const broken=makeSession('return_logo');
  broken.running=false;broken.status='Failed after 3 retries: Expected stage: return_menu';
  broken.retryCount=3;broken.candidateTabIds=[99];
  sessionStore.session=broken;sessionStore.beepState={remaining:8};
  const countTabs=tabs.size;
  const result=await send({type:'COMMAND',command:'RESET'},11);
  assert.equal(result.ok,true);
  assert.equal(sessionStore.session.running,false);
  assert.equal(sessionStore.session.phase,'idle');
  assert.equal(sessionStore.session.status,'Ready — press Start');
  assert.equal(sessionStore.session.appTabId,undefined);
  assert.equal(sessionStore.session.retryCount,undefined);
  assert.equal(sessionStore.beepState,undefined);
  assert.deepEqual(localStore.settings,configured,'Reset must not change saved preferences');
  assert.equal(tabs.size,countTabs,'Reset must not close tabs');
  assert(disabled.includes(11)&&disabled.includes(22));
  for(const name of ['job-refresh','stage-watchdog','shift-eval','return-to-search','beep'])
    assert(alarmCleared.includes(name),`Missing cleared alarm: ${name}`);
  localStore.settings=oldSettings;
});

test('After Reset, Start makes a fresh job-search session rather than resuming a stale application',async()=>{
  const oldSettings=clone(localStore.settings);
  localStore.settings={...clone(DEFAULTS),box1:{mode:'priority',keywords:['Poole']},
    shifts:{...clone(DEFAULTS.shifts),minHours:10,maxHours:15}};
  sessionStore.session=makeSession('shift');
  sessionStore.session.running=false;sessionStore.session.status='Stopped';
  const before=reloaded.length;
  await send({type:'COMMAND',command:'RESET'},11);
  const result=await send({type:'COMMAND',command:'START'},11);
  assert.equal(result.ok,true);
  assert.equal(sessionStore.session.running,true);
  assert.equal(sessionStore.session.phase,'search');
  assert.equal(sessionStore.session.searchTabId,11);
  assert.equal(sessionStore.session.appTabId,null);
  assert.deepEqual(sessionStore.session.triedKeys,[]);
  assert.deepEqual(reloaded.slice(before),[], 'Start must inspect existing cards before any scheduled refresh');
  assert.deepEqual(sessionStore.session.config.box1.keywords,['Poole']);
  localStore.settings=oldSettings;
  await send({type:'COMMAND',command:'STOP'},11);
});

test('Reset works with no existing session or valid saved shift hours',async()=>{
  const oldSettings=clone(localStore.settings);
  localStore.settings=clone(DEFAULTS);
  await chrome.storage.session.clear();
  const result=await send({type:'COMMAND',command:'RESET'},11);
  assert.equal(result.ok,true);
  assert.equal(sessionStore.session.phase,'idle');
  assert.equal(localStore.settings.shifts.minHours,null);
  localStore.settings=oldSettings;
});


test('active human challenge in a tracked application tab pauses instantly, without recovery reload or clicking',async()=>{
  tabs.set(22,{id:22,url:'https://hiring.amazon.com/application',status:'complete'});
  const s=makeSession('shift');s.phaseEntered=Date.now()-5000;sessionStore.session=s;
  const before=reloaded.length, clicks=clicked.length;
  await send({type:'OBSERVATION',snapshot:snap({securityBlocked:true,step2:true,
    shiftCards:[{id:'qualify',key:'x',weeklyHours:12,workingDays:5,startTime:'06:00',order:0}]})});
  assert.equal(s.running,false);
  assert.equal(s.pauseReason,'security');assert.equal(s.securityTabId,22);
  assert.match(s.status,/manual security verification/i);
  assert.equal(reloaded.length,before);assert.equal(clicked.length,clicks);
  await send({type:'WATCH_TICK',generation:71});
  assert.equal(reloaded.length,before,'Do not refresh during a manually paused verification');
});

test('security challenge on an Amazon-created application candidate stops before app evidence is verified',async()=>{
  const s=makeSession('await_app');s.appTabId=null;s.candidateTabIds=[44];sessionStore.session=s;
  tabs.set(44,{id:44,url:'https://challenge.example.org/human-check',status:'complete'});
  await send({type:'OBSERVATION',snapshot:snap({url:'https://challenge.example.org/human-check',appEvidence:false,securityBlocked:true})},44);
  assert.equal(s.running,false);assert.equal(s.pauseReason,'security');assert.equal(s.securityTabId,44);
  assert.equal(s.appTabId,null,'Challenge tab was not misidentified as fully verified application');
  assert(disabled.includes(44),'Candidate adapter must be disabled during manual security pause');
});

test('manual Start is refused until security challenge disappears, then resumes without immediate reload',async()=>{
  const s=makeSession('shift');s.running=false;s.pauseReason='security';s.securityTabId=22;
  s.status='Stopped: manual security verification required';sessionStore.session=s;
  securityStates.set(22,true);
  const before=reloaded.length, clickBefore=clicked.length;
  const refused=await send({type:'COMMAND',command:'START'},11);
  assert.equal(refused.ok,false);assert.match(refused.error,/still visible/i);
  assert.equal(s.running,false);assert.equal(reloaded.length,before);assert.equal(clicked.length,clickBefore);
  securityStates.delete(22);
  const resumed=await send({type:'COMMAND',command:'START'},11);
  assert.equal(resumed.ok,true);assert.equal(s.running,true);assert.equal(s.pauseReason,null);
  assert.equal(reloaded.length,before,'Manual resume must not reload a just-verified page');
  await send({type:'COMMAND',command:'STOP'},11);
});

test('manual Start after challenge on unopened app candidate re-detects that candidate',async()=>{
  const s=makeSession('await_app');s.running=false;s.pauseReason='security';s.securityTabId=44;
  s.appTabId=null;s.candidateTabIds=[44];sessionStore.session=s;
  securityStates.delete(44);
  const resumed=await send({type:'COMMAND',command:'START'},11);
  assert.equal(resumed.ok,true);assert.equal(s.running,true);assert.equal(s.phase,'await_app');
  assert.equal(s.appTabId,null);
  await send({type:'COMMAND',command:'STOP'},11);
});

const recommendedSnapshot=(cards,changes={})=>snap({
  url:'https://www.jobsatamazon.co.uk/app#/jobSearch',hostname:'www.jobsatamazon.co.uk',
  isSearch:true,activeRecommended:'yes',recommendedResults:true,loading:false,
  jobCards:cards.map((key,i)=>({id:`card-${key}`,targets:[`card-${key}`],key,
    text:`Delivery Station Warehouse Associate Within 0.${i+1} mi | ${key}, England`,
    locationText:`${key}, England`,distanceMiles:(i+1)/10,order:i})),...changes
});

test('no shift cards: directly rendered no-available-shift page triggers 7A then 8A, never submits preferences',async()=>{
  tabs.set(22,{id:22,url:'https://www.jobsatamazon.co.uk/application/uk/#/no-available-shift',status:'complete'});
  const s=makeSession('after_start');sessionStore.session=s;
  const prior=clicked.length, priorReload=reloaded.length;
  const noCards=snap({noShiftPage:true,step2:false,shiftCards:[],buttons:{homeLogo:'logo'}});
  await send({type:'OBSERVATION',snapshot:noCards});
  assert.equal(s.phase,'return_jobs');
  assert.match(s.status,/Click 7A/);
  await send({type:'OBSERVATION',snapshot:snap({buttons:{seeAllJobs:'all'}})});
  assert.equal(s.phase,'return_wait');
  const actions=clicked.slice(prior).map(([,label])=>label);
  assert.deepEqual(actions,['Click 7A — Amazon Jobs logo','Click 8A — See all jobs']);
  assert.equal(reloaded.length,priorReload,'No missing-stage refresh for an expected no-shifts page');
  await send({type:'OBSERVATION',snapshot:snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch'})});
  assert.equal(s.phase,'search');
  assert(s.triedKeys.includes('job-plymouth'));
  assert.equal(s.running,true);
  s.running=false;
});

test('no-shifts page is recognised directly from the first app stage',async()=>{
  tabs.set(22,{id:22,url:'https://www.jobsatamazon.co.uk/application/uk/#/no-available-shift',status:'complete'});
  const s=makeSession('next');sessionStore.session=s;
  await send({type:'OBSERVATION',snapshot:snap({noShiftPage:true,step2:false,buttons:{homeLogo:'logo'}})});
  assert.equal(s.phase,'return_jobs');
  assert(s.triedKeys.includes('job-plymouth'));
  s.running=false;
});

test('after an unsuccessful job, another eligible card is chosen without repeating the first',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  const s=makeSession('search');s.appTabId=null;
  s.triedKeys=['Peterborough'];s.currentJobKey='Peterborough';
  s.config.box1={mode:'priority',keywords:['Peterborough','Tilbury']};
  s.resultsSignature='';s.resultsStableSince=0;s.missingTriedJobs={};sessionStore.session=s;
  const before=clicked.length;
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Peterborough','Tilbury'])},11);
  assert.equal(s.phase,'job_details');
  assert.equal(s.currentJobKey,'Tilbury');
  assert.deepEqual(s.triedKeys,['Peterborough','Tilbury']);
  assert(clicked.slice(before).some(([,lab])=>lab==='Click 1 — selected job card'));
  s.running=false;
});

test('scheduled refresh does not clear tried job IDs and does not reopen a still-visible failed card',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  const s=makeSession('search');s.appTabId=null;s.triedKeys=['Peterborough'];s.currentJobKey=null;
  s.config.box1={mode:'required',keywords:['Peterborough']};sessionStore.session=s;
  await send({type:'COMMAND',command:'MANUAL_REFRESH'},11);
  assert(s.triedKeys.includes('Peterborough'),'Refresh must retain attempted jobs');
  const before=clicked.length;
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Peterborough'])},11);
  assert.equal(s.phase,'search');
  assert.equal(clicked.length,before,'Do not select an already attempted job after refresh');
  s.running=false;
});

test('tried job requires stable confirmed disappearance and then reappearance before retry',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  const s=makeSession('search');s.appTabId=null;s.triedKeys=['Peterborough'];
  s.config.box1={mode:'required',keywords:['Peterborough']};sessionStore.session=s;
  const initial=clicked.length;
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Peterborough','Tilbury'])},11);
  assert(s.triedKeys.includes('Peterborough'));
  // During refresh an empty list or a loading skeleton is not disappearance.
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot([], {loading:true})},11);
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot([], {loading:false})},11);
  assert(s.triedKeys.includes('Peterborough'));
  // Another actual job stays visible while the original is absent.
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Tilbury'])},11);
  assert(s.triedKeys.includes('Peterborough'));
  s.missingTriedJobs.Peterborough=Date.now()-3500;
  s.resultsStableSince=Date.now()-3500;
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Tilbury'])},11);
  assert(!s.triedKeys.includes('Peterborough'),'Confirmed stable absence unlocks ID');
  assert.equal(s.phase,'search','Required keyword means unrelated card not selected');
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Peterborough','Tilbury'])},11);
  assert.equal(s.phase,'job_details');
  assert.equal(s.currentJobKey,'Peterborough');
  assert.equal(clicked.length,initial+1);
  s.running=false;
});

test('brief absence followed by a reappearance does not clear rejected job',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  const s=makeSession('search');s.appTabId=null;s.triedKeys=['Peterborough'];
  s.config.box1={mode:'required',keywords:['Peterborough']};sessionStore.session=s;
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Tilbury'])},11);
  await send({type:'OBSERVATION',snapshot:recommendedSnapshot(['Peterborough','Tilbury'])},11);
  assert(s.triedKeys.includes('Peterborough'));
  assert.equal(s.phase,'search');
  s.running=false;
});

test('unexpected Amazon logout stops automation rather than refreshing or clicking',async()=>{
  tabs.set(22,{id:22,url:'https://hiring.amazon.com/login',status:'complete'});
  sessionStore.session=makeSession('shift');
  const oldClicks=clicked.length,oldReloads=reloaded.length;
  await send({type:'OBSERVATION',snapshot:snap({loginRequired:true,securityBlocked:false})});
  assert.equal(sessionStore.session.running,false);
  assert.equal(sessionStore.session.pauseReason,'login');
  assert.match(sessionStore.session.status,/login required/i);
  assert.equal(clicked.length,oldClicks);assert.equal(reloaded.length,oldReloads);
});

test('a new meaningful text addition on a still-visible unsuccessful card triggers a new attempt',async()=>{
  sessionStore.session=makeSession('search');const s=sessionStore.session;
  s.triedKeys=['job-poole'];s.triedSnapshots={'job-poole':'Warehouse Associate Type: Reduced Within 0.1 mi | Poole, England'};
  s.config.box1={mode:'required',keywords:['Poole']};
  const updated={...snap({isSearch:true,activeRecommended:'yes',recommendedResults:true,
    url:'https://www.jobsatamazon.co.uk/app#/jobSearch',
    jobCards:[{id:'card-changed',targets:['card-changed'],key:'job-poole',title:'Warehouse Associate',
      text:'Warehouse Associate Type: Reduced Part Time Within 0.1 mi | Poole, England',locationText:'Poole, England',distanceMiles:0.1,order:0}]}),hostname:'www.jobsatamazon.co.uk'};
  await send({type:'OBSERVATION',snapshot:updated},11);
  assert.equal(sessionStore.session.phase,'job_details',JSON.stringify({tried:sessionStore.session.triedKeys,diagnostics:sessionStore.session.searchDiagnostics,status:sessionStore.session.status,attempts:sessionStore.session.triedSnapshots}));
  assert(clicked.some(x=>x[1]==='Click 1 — selected job card'));
  assert(sessionStore.session.triedSnapshots['job-poole'].includes('Part Time'));
  sessionStore.session.running=false;
});

test('scheduled status alarm uses actual current stage, works when stopped, and does not change automation',async()=>{
  // Existing controller may be stopped from a prior test; this status report
  // must reflect the current session without clicking or changing its stage.
  const saved=makeSession('shift');saved.status='Reading shift cards';saved.running=true;
  sessionStore.session=saved;
  const relay=await send({type:'COMMAND',command:'RELAY_CONFIGURE',relay:{enabled:true,apiKey:'test-key'}});
  assert.equal(relay.ok,true);
  const toggle=await send({type:'COMMAND',command:'RELAY_STATUS_INTERVAL',enabled:true});
  assert.equal(toggle.ok,true);
  assert.equal(localStore.relayStatusEnabled,true);
  globalThis.fetch=async()=>{throw Error('simulated offline')};
  await listeners.alarm({name:'relay-status'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(sessionStore.session.running,true,'Heartbeat must never stop the controller');
  const item=(localStore.relayPending||[]).find(x=>x.event.event_type==='automation_status');
  assert(item,'Status event is queued for offline retry');
  assert.deepEqual(item.event.data,{stage:'shift',state:'running',detail:'Reading shift cards'});
  await send({type:'COMMAND',command:'RELAY_STATUS_INTERVAL',enabled:false});
  assert.equal(localStore.relayStatusEnabled,false);
});

test('public jobs-found view without Recommended stops running session and suppresses refreshing',async()=>{
  tabs.set(11,{id:11,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',status:'complete'});
  sessionStore.session=makeSession('search');
  const beforeClicks=clicked.length,beforeReloads=reloaded.length;
  await send({type:'OBSERVATION',snapshot:snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',
    publicJobSearch:true,activeRecommended:'unknown',recommendedResults:false,
    jobCards:[{key:'public-job',id:'public-job',text:'Warehouse Associate – Poole'}]})},11);
  const s=sessionStore.session;
  assert.equal(s.running,true,'brief public-search shell must not cause a premature logout alert');
  assert.match(s.status,/Checking sign-in/);
  s.publicSearchFirstSeenAt=Date.now()-1100;
  await send({type:'OBSERVATION',snapshot:snap({isSearch:true,url:'https://www.jobsatamazon.co.uk/app#/jobSearch',
    publicJobSearch:true,activeRecommended:'unknown',recommendedResults:false,
    jobCards:[{key:'public-job',id:'public-job',text:'Warehouse Associate – Poole'}]})},11);
  assert.equal(s.running,false);
  assert.equal(s.pauseReason,'login');
  assert.match(s.status,/login required/i);
  assert.match(s.terminalReason,/public jobs-found search/i);
  assert.equal(clicked.length,beforeClicks);
  assert.equal(reloaded.length,beforeReloads);
  await send({type:'WATCH_TICK',generation:71},11);
  assert.equal(reloaded.length,beforeReloads,'watchdog must not restart after sign-out');
});
