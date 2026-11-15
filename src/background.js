import {DEFAULTS,clone,normaliseSettings,rankJobs,rankShifts,nextClockRefresh,validateShiftSettings,ukParts,isFast} from './rules.js';
import {enqueueRelayEvent,flushRelayQueue,configureRelay,relayPublicStatus,testRelay,getRelayConfig} from './relay.js';
import {addedCardText,makeShiftRecord,shiftDecision,shiftVisitReport} from './telemetry.js';
import {validateReceiverConfig,validateOracleSignal,trimSeenSignals,enqueueSignal,MAX_PENDING_SIGNALS,SIGNAL_MODE_ORACLE,shouldCompleteSignalCycle,availabilityIdentity} from './signal_rules.js';
import {createReceiverAudit} from './receiver_audit.js';

/* One owner for tabs, clicks, session state, retries and alerts.  The adapter
   does not click by itself. Chrome session storage intentionally clears on restart. */
let chain=Promise.resolve();
const ordered=fn=>{const p=chain.then(fn,fn);chain=p.catch(e=>{
  console.error('controller',e);
  notify('automation_error',{stage:'background_controller',error:String(e).slice(0,300),recovery_attempts:0,action:'controller_exception'});
});return p;};
const SKEY='session', CKEY='settings';
// Wait 3 seconds before treating an unchanged, non-loading stage as stuck.
// DOM mutations still trigger immediate scans; this is not a click delay.
const STALLED_STAGE_GRACE_MS=3000;
// chrome.alarms persists across MV3 service worker suspension.
// This status event requires the separate, opt-in Oracle relay compatibility patch.
const STATUS_ALARM='relay-status';
async function syncStatusAlarm(){
  const cfg=await getRelayConfig();
  const setting=(await chrome.storage.local.get('relayStatusEnabled')).relayStatusEnabled;
  if(!cfg.enabled||!cfg.apiKey||!setting){await chrome.alarms.clear(STATUS_ALARM);return;}
  if(!await chrome.alarms.get(STATUS_ALARM))
    await chrome.alarms.create(STATUS_ALARM,{delayInMinutes:20,periodInMinutes:20});
}
// Signal receiving is independent of the outbound Oracle->Telegram relay.
const SIGNAL_STATUS_KEY='oracleSignalStatus';
const SIGNAL_CONFIG_KEY='oracleReceiverConfig';
const SIGNAL_SEEN_KEY='oracleSeenSignalIds';
const SIGNAL_JOURNAL_KEY='oracleSignalJournal';
const SIGNAL_HEALTH_ALARM='oracle-signal-health';
const RECEIVER_ENDPOINT='wss://145-241-233-33.sslip.io/v1/receivers/ws';
const isOracle=s=>s?.config?.refreshMode===SIGNAL_MODE_ORACLE;
const receiverAudit=createReceiverAudit({storage:chrome.storage.local});
// Receivers record observed transitions locally; never wait for the queue when
// clicking a job or a shift. No Stage 5D upload endpoint has been configured.
function audit(s,event_type,extra={}){
  if(!isOracle(s))return;
  const signal=s.activeSignalData||{};
  const identity=availabilityIdentity(signal)||{};
  const details={signal_id:s.activeSignalId||identity.signal_id||'',receiver_id:s.receiverId||'',
    job_key:s.currentJobKey||identity.job_key||'',content_version:identity.content_version||'',
    appearance_episode:identity.appearance_episode||'',state:s.running?(s.signalCycleActive?'PROCESSING':'AVAILABLE'):(s.status==='Completed'?'SUCCESS_STOPPED':'STOPPED'),
    phase:s.phase||'',title:s.currentJobTitle||'',location:s.currentJobLocation||'',
    visit_id:s.shiftVisit?.visit_id||'',...extra};
  const {pending}=receiverAudit.record(event_type,details);
  void pending.catch(()=>{}); // quota/permission errors are non-fatal to the application
}

async function signalJournal(){return (await chrome.storage.local.get(SIGNAL_JOURNAL_KEY))[SIGNAL_JOURNAL_KEY]||{};}
async function persistSignalJournal(s){
  if(!isOracle(s))return;
  const now=Date.now();
  const pending=(s.pendingSignals||[]).filter(x=>x&&Number.isFinite(x.receivedAt)&&now-x.receivedAt<24*60*60*1000).slice(0,MAX_PENDING_SIGNALS);
  await chrome.storage.local.set({[SIGNAL_JOURNAL_KEY]:{pending,active:s.activeSignalData||null}});
}
async function receiverConfig(){return {endpoint:RECEIVER_ENDPOINT,...((await chrome.storage.local.get(SIGNAL_CONFIG_KEY))[SIGNAL_CONFIG_KEY]||{})};}
async function receiverPublicStatus(){
  const [stored,connection,session]=await Promise.all([
    receiverConfig(),chrome.storage.session.get(SIGNAL_STATUS_KEY),getSession()]);
  const receiverState=session?.status==='Completed'&&isOracle(session)?'SUCCESS_STOPPED':session?.pauseReason&&isOracle(session)?'PAUSED':!session?.running?'STOPPED':!isOracle(session)?'DISABLED':session.signalCycleActive?'PROCESSING':connection[SIGNAL_STATUS_KEY]?.connected?'AVAILABLE':connection[SIGNAL_STATUS_KEY]?.state==='reconnecting'?'RECONNECTING':'CONNECTING';
  return {endpoint:stored.endpoint||RECEIVER_ENDPOINT,receiverId:stored.receiverId||'',configured:!validateReceiverConfig(stored),receiverState,
    currentStage:session?.phase||'idle',currentJob:session?.currentJobTitle||'',
    connection:connection[SIGNAL_STATUS_KEY]||{state:'stopped'},
    refreshMode:session?.config?.refreshMode||(await getSettings()).refreshMode,
    pending:session?.pendingSignals?.length||0,currentSignalId:session?.activeSignalId||'',
    audit:await receiverAudit.status(),acknowledgement:connection[SIGNAL_STATUS_KEY]?.lastAck||null,
    activeCycle:!!session?.signalCycleActive,lastSignal:session?.lastSignal||null};
}
async function ensureOffscreenDocument(){
  const has=await chrome.offscreen.hasDocument();
  const marker=(await chrome.storage.session.get('oracleOffscreenWorkDoc')).oracleOffscreenWorkDoc;
  // A sound-only document can auto-close after 30 seconds of silence. Replace
  // it with a worker-purpose document when first entering Oracle mode.
  if(has&&!marker){
    await chrome.offscreen.closeDocument();
  }
  if(!has||!marker){
    await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS','AUDIO_PLAYBACK'],justification:'Listen for authorised Oracle broadcasts and preserve existing audio alerts'});
    await chrome.storage.session.set({oracleOffscreenWorkDoc:true});
  }
}
async function signalConnect(s){
  if(!s?.running||!isOracle(s))return {ok:false,error:'Oracle Signal Only mode is not running'};
  const config=await receiverConfig();const error=validateReceiverConfig(config);
  if(error)return {ok:false,error};
  try{
    await ensureOffscreenDocument();
    // A freshly created offscreen module may take a moment to register its
    // listener; retry its internal handshake without hitting Amazon/Oracle.
    let result=null;
    for(let attempt=0;attempt<4;attempt++){
      result=await chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_CONNECT',config}).catch(()=>null);
      if(result?.ok)break;
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(!result?.ok)return {ok:false,error:result?.error||'Oracle listener did not acknowledge connection request'};
    if(!await chrome.alarms.get(SIGNAL_HEALTH_ALARM))await chrome.alarms.create(SIGNAL_HEALTH_ALARM,{periodInMinutes:1});
    return {ok:true};
  }catch{return {ok:false,error:'Could not initialise Oracle signal listener'};}
}
async function signalDisconnect(){
  await chrome.alarms.clear(SIGNAL_HEALTH_ALARM);
  await chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_DISCONNECT'}).catch(()=>{});
  await chrome.storage.session.set({[SIGNAL_STATUS_KEY]:{state:'stopped',connected:false,at:Date.now()}});
}
async function enterSignalWaiting(s,reason='Waiting for Oracle detection signal'){
  if(s.signalCycleActive)audit(s,'signal_processing_completed',{reason,outcome:'no_qualifying_job_or_shift',latency_ms:s.signalStartedAt?Date.now()-s.signalStartedAt:null});
  s.signalCycleActive=false;s.signalAwaitingReload=false;s.activeSignalId=null;s.activeSignalData=null;s.cycleEmptyAt=null;s.cycleEmptySignature='';
  await persistSignalJournal(s);
  s.currentJobKey=null;s.currentJobTitle='';s.currentJobLocation='';
  await disarm();s.nextRefresh=null;
  if(Number.isInteger(s.searchTabId))await msg(s.searchTabId,{type:'ARM_CLOCK',when:null});
  status(s,'WAITING FOR ORACLE SIGNAL — '+reason);
  audit(s,'receiver_waiting',{reason});
  await saveSession(s);
}
async function processPendingSignal(s){
  if(!s?.running||!isOracle(s)||s.signalCycleActive||s.phase!=='search')return;
  s.pendingSignals=(s.pendingSignals||[]).filter(x=>Number.isFinite(x.receivedAt)&&Date.now()-x.receivedAt<24*60*60*1000);
  const next=s.pendingSignals.shift();
  if(next)audit(s,'signal_dequeued',{signal_id:next.event_id,job_key:next.job_key||next.job_id||''});
  if(!next){await persistSignalJournal(s);await saveSession(s);return;}
  await startSignalCycle(s,next);
}
async function startSignalCycle(s,signal){
  if(!s?.running||!isOracle(s)||s.signalCycleActive)return false;
  // A new validated event creates a new attempt history; the existing
  // per-cycle history stops reapplying to the same unsuccessful job.
  s.signalCycleActive=true;s.signalAwaitingReload=true;s.activeSignalId=signal.event_id;s.activeSignalData=signal;s.signalStartedAt=Date.now();s.lastSignal={event_id:signal.event_id,receivedAt:Date.now(),job_id:signal.job_id};
  audit(s,'signal_processing_started',{source:signal.type});
  s.triedKeys=[];s.triedSnapshots={};s.missingTriedJobs={};s.resultsSignature='';s.resultsStableSince=0;s.auditJobSignature='';s.auditSkippedKeys=[];
  s.cycleEmptyAt=null;s.cycleEmptySignature='';
  audit(s,'job_search_started',{source:'oracle_signal'});
  status(s,'Oracle signal received — refreshing Recommended jobs');
  await persistSignalJournal(s);await saveSession(s);
  const refreshed=await refresh(s,Date.now());
  if(!refreshed&&s.running){await enterSignalWaiting(s,'Search refresh unavailable');await processPendingSignal(s);}
  return refreshed;
}
async function acceptSignal(signal){
  const valid=validateOracleSignal(signal);if(!valid)return {ok:false,error:'Invalid Oracle job-detection signal'};
  const s=await getSession();if(!s?.running||!isOracle(s))return {ok:false,error:'Receiver is not running in Oracle mode'};
  const now=Date.now();
  audit(s,'signal_received',{signal_id:valid.event_id,job_key:valid.job_key||valid.job_id,content_version:valid.content_version||'',appearance_episode:valid.appearance_episode||'',oracle_detected_at:valid.detected_at,source:valid.type});
  const local=await chrome.storage.local.get(SIGNAL_SEEN_KEY);
  const seen=trimSeenSignals(local[SIGNAL_SEEN_KEY],now);
  if(seen.some(x=>x.id===valid.event_id)){audit(s,'signal_duplicate',{signal_id:valid.event_id,outcome:'ignored_retransmission'});return {ok:true,duplicate:true};}
  if((s.pendingSignals?.length||0)>=MAX_PENDING_SIGNALS){
    audit(s,'signal_queue_overflow',{signal_id:valid.event_id,outcome:'not_accepted'});
    status(s,'Oracle signal queue full — ignoring additional signals until processed');await saveSession(s);
    return {ok:false,error:'Pending signal queue is full'};
  }
  seen.push({id:valid.event_id,at:now});
  s.pendingSignals??=[];
  const added=enqueueSignal(s.pendingSignals,{...valid,receivedAt:now});s.pendingSignals=added.queue;
  // Persist the event and dedup ID in ONE local-storage operation before
  // confirming receipt to the offscreen worker. No unverified server ACK.
  await chrome.storage.local.set({
    [SIGNAL_SEEN_KEY]:trimSeenSignals(seen,now),
    [SIGNAL_JOURNAL_KEY]:{pending:s.pendingSignals,active:s.activeSignalData||null}
  });
  s.lastSignal={event_id:valid.event_id,job_id:valid.job_id,receivedAt:now};
  await saveSession(s);
  audit(s,'signal_persisted',{signal_id:valid.event_id,job_key:valid.job_key||valid.job_id,content_version:valid.content_version||'',appearance_episode:valid.appearance_episode||'',outcome:'queued_locally'});
  if(s.signalCycleActive||s.phase!=='search')audit(s,'signal_queued_while_busy',{signal_id:valid.event_id});
  // The transport must ACK as soon as the signal is safely persisted. Queue
  // the refresh controller separately rather than making Oracle wait for
  // security preflight or a Chrome navigation to finish.
  if(!s.signalCycleActive&&s.phase==='search'){
    queueMicrotask(()=>{void ordered(async()=>{
      const current=await getSession();
      if(current?.running&&isOracle(current)&&!current.signalCycleActive&&current.phase==='search')
        await processPendingSignal(current);
    });});
  }
  return {ok:true,queued:true};
}
async function switchRefreshMode(mode){
  const active=await getSession();
  if(active?.running&&active.config.refreshMode!==mode&&appPhase(active.phase))
    return {ok:false,error:'Stop or finish the active application before switching refresh modes.'};
  if(mode===SIGNAL_MODE_ORACLE){const error=validateReceiverConfig(await receiverConfig());if(error)return {ok:false,error};}
  const s=await getSession();
  if(!s?.running)return {ok:true};
  if(s.config.refreshMode===mode)return {ok:true};
  s.config.refreshMode=mode;
  if(mode===SIGNAL_MODE_ORACLE){
    await disarm();s.nextRefresh=null;
    // An existing application is allowed to finish; signals will queue.
    if(s.phase==='search')await enterSignalWaiting(s,'Switched refresh mode');
    else await msg(s.searchTabId,{type:'ARM_CLOCK',when:null});
    const connected=await signalConnect(s);
    if(!connected.ok){status(s,'Oracle receiver setup needed: '+connected.error);await saveSession(s);}
  }else{
    await signalDisconnect();
    s.signalCycleActive=false;s.pendingSignals=[];s.activeSignalId=null;
    if(searchPhase(s.phase)){status(s,'Built-in UK refresh schedule active');await arm(s);}
    await saveSession(s);
  }
  return {ok:true};
}
function statusSnapshot(s){
  const state=s?.running?'running':s?.pauseReason?'paused':s?.status==='Completed'?'completed':'stopped';
  return {stage:String(s?.phase||'idle').slice(0,200),state,
    detail:String(s?.status||(state==='stopped'?'Extension is stopped':'Status unavailable')).slice(0,500)};
}
async function sendStatusHeartbeat(){
  const session=await getSession();
  const body=statusSnapshot(session);
  // Ordinary event dedup and the existing rate-limit/retry queue are preserved.
  notify('automation_status',body);
}

// Best effort notifications must never block an application click or stage.
function notify(type,data){void enqueueRelayEvent(type,data).catch(e=>console.warn('Relay event queue:',e));}
function jobContext(s){return {job_id:s.currentJobKey||'',title:s.currentJobTitle||'',location:s.currentJobLocation||''};}
function newShiftVisit(s){
  if(s.shiftVisit&&!s.shiftVisit.completed)return;
  s.shiftVisit={visit_id:crypto.randomUUID(),job:jobContext(s),cards:[],completed:false};
  audit(s,'shift_visit_started');
}
function collectShiftCards(s,cards){
  newShiftVisit(s);
  for(const card of cards||[]){
    const record=makeShiftRecord(card,s.shiftVisit.visit_id,s.shiftVisit.job);
    const at=s.shiftVisit.cards.findIndex(x=>x.key===record.key);
    if(at<0){
      s.shiftVisit.cards.push(record);
      audit(s,'shift_card_observed',{shift_key:record.key||'',shift_start_date:record.start_date||'',shift_end_date:record.end_date||'',
        shift_days:record.shift_days||String(record.working_days??''),
        shift_time:[record.start_time,record.end_time].filter(Boolean).join('–'),shift_hours:record.weekly_hours,
        shift_pay:record.pay||'',shift_count:s.shiftVisit.cards.length});
    }else s.shiftVisit.cards[at]={...record};
  }
}
function finishShiftVisit(s,reason,selectedKey=null){
  if(!s.shiftVisit||s.shiftVisit.completed)return;
  const v=s.shiftVisit;const cards=v.cards;
  const ranked=rankShifts(cards.map((c,i)=>({...c,weeklyHours:c.weekly_hours,workingDays:c.working_days,startTime:c.start_time,order:i})),s.config.shifts);
  const eligibleKeys=ranked.map(x=>x.key);
  cards.forEach(card=>{
    const decision=shiftDecision(card,s.config.shifts);
    card.rank=eligibleKeys.indexOf(card.key)<0?null:eligibleKeys.indexOf(card.key)+1;
    card.decision=selectedKey===card.key?'selected':decision.eligible?'eligible':'rejected';
    card.rejection_reasons=decision.reasons;
  });
  v.completed=true;
  for(const card of cards){audit(s,'shift_card_evaluated',{shift_key:card.key,decision:card.decision,reason:(card.rejection_reasons||[]).join('; '),shift_count:cards.length});}
  audit(s,'shift_visit_completed',{outcome:selectedKey?'shift_selected':cards.length?'shifts_rejected':'no_shift_cards',reason,shift_count:cards.length});
  // Exactly ONE Telegram event per shift-selection visit. All detected cards,
  // decisions, ranks, rejection reasons and original text are present in the
  // final payload for the relay's complete CSV attachment. This avoids the
  // previous duplicate stream of shift_card_detected + shift_selection_result
  // + no_suitable_shifts + shift_visit_completed messages. Only this report
  // is delayed until the visit outcome is known; errors, logout, security and
  // other non-shift alerts still enqueue immediately via notify().
  const report=shiftVisitReport(v,reason,selectedKey);
  notify(report.type,report.data);
  void rememberOracleAttempt(s,reason,selectedKey,cards.length).catch(()=>{});
}
// Historical results are for diagnostics only. They never block a new
// Oracle detection event from reconsidering a previously unsuccessful job.
async function rememberOracleAttempt(s,reason,selectedKey,cardCount){
  if(!isOracle(s)||!s.activeSignalId||!s.currentJobKey)return;
  const key='oracleAttemptHistory';
  const previous=(await chrome.storage.local.get(key))[key]||[];
  const cutoff=Date.now()-7*24*60*60*1000;
  const history=previous.filter(x=>Number.isFinite(x.at)&&x.at>=cutoff);
  history.push({at:Date.now(),signal_id:s.activeSignalId,job_id:s.currentJobKey,
    content_version:s.activeSignalData?.content_version||null,appearance_episode:s.activeSignalData?.appearance_episode||null,
    outcome:selectedKey?'selected':'no_matching_shift',reason:String(reason).slice(0,160),cardCount});
  await chrome.storage.local.set({[key]:history.slice(-500)});
}
function noteUnexpected(s,reason,action){
  audit(s,'recovery_or_error',{error_class:'unexpected_stage',reason,source:action,recovery_attempts:s.retryCount||0});
  notify('automation_error',{...jobContext(s),stage:s.phase,error:String(reason).slice(0,300),last_action:s.status,
    recovery_attempts:s.retryCount||0,action});
}

const getSession=async()=> (await chrome.storage.session.get(SKEY))[SKEY]||null;
const saveSession=async s=>chrome.storage.session.set({[SKEY]:s});
const getSettings=async()=>normaliseSettings((await chrome.storage.local.get(CKEY))[CKEY]);
const msg=(tabId,body)=>chrome.tabs.sendMessage(tabId,body).catch(()=>null);
const exists=async id=>{if(!Number.isInteger(id))return false;try{return Boolean(await chrome.tabs.get(id));}catch{return false;}};
const isAmazonSearch=url=>{try{const u=new URL(url);return /(^|\.)jobsatamazon\.co\.uk$/i.test(u.hostname)&&(/jobsearch/i.test(u.hash)||/jobsearch/i.test(u.pathname));}catch{return false;}};
const validUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&/(^|\.)jobsatamazon\.co\.uk$/i.test(u.hostname);}catch{return false;}};
function activeSession(s){return Boolean(s?.running);}
function status(s,value){s.status=value;s.changedAt=Date.now();}
function enter(s,phase,description){if(s.phase!==phase)audit(s,'application_stage_entered',{phase,source:description||''});s.phase=phase;s.phaseEntered=Date.now();s.retryCount=0;s.lastObservationAt=0;s.lastObservedLoading=false;s.lastStep2SeenAt=0;s.shiftSeenAt=0;s.shiftLastChanged=0;s.shiftSignature='';if(description)status(s,description);}
const searchPhase=phase=>['search','job_details'].includes(phase);
const appPhase=phase=>!['search','job_details'].includes(phase);
async function disarm(){await chrome.alarms.clear('job-refresh');}
async function arm(s){
  await disarm();
  if(!activeSession(s)||isOracle(s)||s.phase!=='search'&&s.phase!=='job_details'){s.nextRefresh=null;return;}
  const next=nextClockRefresh(Date.now(),s.config);
  s.nextRefresh=next;
  if(next){await chrome.alarms.create('job-refresh',{when:next.when});await msg(s.searchTabId,{type:'ARM_CLOCK',when:next.when});}
}
async function securityPreflight(tabId){
  if(!await exists(tabId))return {ok:false,error:'The security-check tab is no longer open. Press Reset to start a fresh session.'};
  try{await chrome.scripting.executeScript({target:{tabId},files:['src/adapter.js']});}
  catch{return {ok:false,error:'Cannot inspect the security-check tab. Complete it manually before restarting.'};}
  const response=await msg(tabId,{type:'SECURITY_STATUS'});
  if(!response?.ok)return {ok:false,error:'Cannot verify that the security check is complete. Do not restart yet.'};
  if(response.loginRequired)return {ok:false,error:'Amazon sign-in is still visible. Log in manually, then press Start.'};
  if(response.publicJobSearch)return {ok:false,error:'Recommended jobs are unavailable. The public job-search page is showing; check your Amazon sign-in, then press Start.'};
  if(response.blocked)return {ok:false,error:'Security verification is still visible. Complete it manually, then press Start.'};
  return {ok:true};
}
async function enable(id,s){
  if(!await exists(id))return false;
  try{await chrome.scripting.executeScript({target:{tabId:id},files:['src/adapter.js']});}catch{return false;}
  const clockAt=id===s.searchTabId&&searchPhase(s.phase)?s.nextRefresh?.when:null;
  return Boolean((await msg(id,{type:'ENABLE',generation:s.generation,clockAt}))?.ok);
}
async function disable(id){if(Number.isInteger(id))await msg(id,{type:'DISABLE'});}
async function alertStop(){
  await chrome.alarms.clear('beep');
  await chrome.storage.session.remove('beepState');
  await chrome.runtime.sendMessage({type:'AUDIO_STOP'}).catch(()=>{});
}
async function beepOnce(){
  try{
    const has=await chrome.offscreen.hasDocument();
    if(!has)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'Play the requested short audible completion/failure alert'});
    await chrome.runtime.sendMessage({type:'AUDIO_BEEP'}).catch(()=>{});
  }catch(e){console.warn('Audio unavailable:',e);}
}
async function alertStart(){
  await alertStop();
  await beepOnce();
  await chrome.storage.session.set({beepState:{remaining:10}});
  await chrome.alarms.create('beep',{delayInMinutes:1,periodInMinutes:1});
}
async function finalise(s,kind,reason){
  if(s.shiftVisit&&!s.shiftVisit.completed)finishShiftVisit(s,'Application interrupted: '+reason);
  audit(s,kind==='success'?'application_completed':'receiver_stopped',{outcome:kind,reason});
  s.running=false;s.nextRefresh=null;
  status(s,kind==='success'?'Completed':kind==='security'?'Stopped: manual security verification required — complete it and press Start':kind==='navigation'?'Stopped — Amazon search page changed unexpectedly':`Failed after 3 retries: ${reason}`);
  s.terminalReason=reason;
  if(kind==='security')s.pauseReason='security';
  if(kind==='login'){s.pauseReason='login';status(s,'Stopped — Amazon login required. Log in manually, then press Start.');}
  if(kind==='success'){
    s.activeSignalData=null;await persistSignalJournal(s);
    const previous=(await chrome.storage.local.get('oracleCompletedJobs')).oracleCompletedJobs||[];
    if(s.currentJobKey)await chrome.storage.local.set({oracleCompletedJobs:[...new Set([...previous,s.currentJobKey])].slice(-500)});
    notify('prehire_appointment',{...jobContext(s),stage:s.phase,reason});
  }
  if(kind==='security')notify('human_verification',{...jobContext(s),stage:s.phase,reason,action_required:'Complete verification manually'});
  if(kind==='login')notify('account_logged_out',{...jobContext(s),stage:s.phase,reason,action_required:'Log in manually'});
  if(kind==='failure')noteUnexpected(s,reason,'stopped');
  notify('automation_stopped',{...jobContext(s),stage:s.phase,reason,stop_type:kind});
  await disarm();await signalDisconnect();await chrome.alarms.clear('stage-watchdog');await chrome.alarms.clear('shift-eval');await chrome.alarms.clear('return-to-search');
  for(const id of new Set([s.searchTabId,s.appTabId,s.securityTabId,...(s.candidateTabIds||[])]))await disable(id);
  await saveSession(s);await alertStart();
}
async function stop(){
  const s=await getSession();
  if(s?.shiftVisit&&!s.shiftVisit.completed)finishShiftVisit(s,'User stopped during shift visit');
  if(s)audit(s,'receiver_stopped',{outcome:'manual',reason:'User pressed Stop'});
  if(s){s.running=false;s.nextRefresh=null;status(s,'Stopped');notify('automation_stopped',{...jobContext(s),stage:s.phase,reason:'User pressed Stop',stop_type:'manual'});await saveSession(s);
    for(const id of new Set([s.searchTabId,s.appTabId,s.securityTabId,...(s.candidateTabIds||[])]))await disable(id);}
  await disarm();await signalDisconnect();await chrome.alarms.clear('stage-watchdog');await chrome.alarms.clear('shift-eval');await chrome.alarms.clear('return-to-search');await alertStop();
  return {ok:true,status:'Stopped'};
}
// A fresh-start escape hatch for a failed/stopped/stale session.
// Never erase chrome.storage.local settings or close any Amazon tabs.
// Run in the same ordered controller queue as other commands so a pending
// observation cannot resurrect the previous stage after reset.
async function resetSession(){
  const old=await getSession();
  // Prevent further actions before stopping the old tab adapters.
  if(old){old.running=false;old.nextRefresh=null;await saveSession(old);}
  for(const alarm of ['job-refresh','stage-watchdog','shift-eval','return-to-search']){
    await chrome.alarms.clear(alarm);
  }
  const ids=[old?.searchTabId,old?.appTabId,...(old?.candidateTabIds||[])];
  for(const id of new Set(ids))await disable(id);
  await signalDisconnect();await alertStop();
  // Only transient session data is cleared. Preferences remain in storage.local.
  await chrome.storage.session.clear();
  await chrome.storage.local.set({[SIGNAL_JOURNAL_KEY]:{pending:[],active:null}});
  await saveSession({running:false,phase:'idle',status:'Ready — press Start',changedAt:Date.now()});
  return {ok:true,status:'Ready — press Start'};
}
async function refresh(s,dueAt=null){
  if(!activeSession(s)||!searchPhase(s.phase))return false;
  if(!await exists(s.searchTabId)){await recoverSearchTab(s);if(!await exists(s.searchTabId))return false;}
  // Never let a scheduled or manual refresh reload a human-check screen.
  const security=await msg(s.searchTabId,{type:'SECURITY_STATUS'});
  if(security?.loginRequired){await finalise(s,'login','Amazon sign-in required on search page');return false;}
  if(security?.publicJobSearch){s.securityTabId=s.searchTabId;await finalise(s,'login','Recommended disappeared and public jobs-found search is displayed; check your Amazon sign-in');return false;}
  if(security?.blocked){s.securityTabId=s.searchTabId;await finalise(s,'security','Visible verification on the controlled search page');return false;}
  // Tried jobs survive scheduled/manual refreshes. A rejected job becomes
  // eligible only after it is confirmed missing from a settled Recommended list.
  // A temporarily empty loading list never clears this history.
  audit(s,'job_search_refresh_requested',{source:'active_signal'});
  s.currentJobKey=null;s.currentJobTitle='';s.currentJobLocation='';s.currentJobTargets=[];s.jobTargetIndex=0;s.jobDetailsStillSearch=false;s.lastRefreshDueAt=dueAt||Date.now();
  s.resultsSignature='';s.resultsStableSince=0;s.missingTriedJobs={};
  enter(s,'search','Refreshing job search');
  // Set the next clock appointment before navigation destroys the page timer.
  await arm(s);await saveSession(s);
  try{await chrome.tabs.reload(s.searchTabId);return true;}catch(e){status(s,'Refresh failed: '+String(e));await saveSession(s);return false;}
}
async function recoverSearchTab(s){
  if(!validUrl(s.config.searchUrl))return;
  const newTab=await chrome.tabs.create({url:s.config.searchUrl,active:false});
  s.searchTabId=newTab.id;await saveSession(s);
}
async function start(manual=false){
  let s=await getSession();
  if(s?.running){
    if(manual&&isOracle(s))return {ok:false,error:'Manual search refresh is disabled in Oracle Signal Only mode. Wait for a validated Oracle signal.'};
    if(manual&&searchPhase(s.phase)){await refresh(s);return {ok:true,status:s.status};}
    return {ok:true,status:s.status};
  }
  // Manual verification never resumes merely because the page changes.
  // Restart requires an explicit Start and a read-only check of the same tab.
  if(s?.pauseReason==='security'||s?.pauseReason==='login'){
    const blockedTab=s.securityTabId??s.appTabId??s.searchTabId;
    const preflight=await securityPreflight(blockedTab);
    if(!preflight.ok)return preflight;
    await alertStop();
    s.running=true;s.pauseReason=null;s.securityTabId=null;s.retryCount=0;
    s.phaseEntered=Date.now();s.lastObservationAt=0;
    status(s,'Manually resumed — detecting current stage');
    await saveSession(s);
    if(s.phase==='await_app'&&s.candidateTabIds?.includes(blockedTab)){
      await enable(blockedTab,s);
      await msg(blockedTab,{type:'SCAN'});
    }else if(appPhase(s.phase)&&s.appTabId===blockedTab){
      await enable(s.appTabId,s);
      await msg(s.appTabId,{type:'SCAN'});
      await scheduleWatchdog(s);
    }else if(searchPhase(s.phase)&&s.searchTabId===blockedTab){
      // Resume the existing search page without an immediate reload that
      // might interrupt navigation just completed manually.
      await arm(s);await enable(s.searchTabId,s);
      await msg(s.searchTabId,{type:'SCAN'});
    }else{
      s.running=false;s.pauseReason=s.pauseReason||'security';s.securityTabId=blockedTab;
      status(s,'Stopped: verify the current page manually, then press Reset');
      await saveSession(s);
      return {ok:false,error:'The previous workflow tab could not be restored. Press Reset after the security check.'};
    }
    if(isOracle(s)){const r=await signalConnect(s);if(!r.ok)return r;}
    return {ok:true,status:s.status};
  }
  await alertStop();
  if(s&&!s.running&&s.status!=='Completed'&&s.appTabId&&appPhase(s.phase)&&await exists(s.appTabId)){
    // Also check any other stopped application stage before enabling clicks.
    const preflight=await securityPreflight(s.appTabId);
    if(!preflight.ok)return preflight;
    s.running=true;status(s,'Resuming '+s.phase);await saveSession(s);await enable(s.appTabId,s);
    await msg(s.appTabId,{type:'SCAN'});scheduleWatchdog(s);
    if(isOracle(s)){const r=await signalConnect(s);if(!r.ok)return r;}return {ok:true,status:s.status};
  }
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const active=tabs[0];
  let search=active&&isAmazonSearch(active.url)?active:null;
  if(!search){
    const matches=await chrome.tabs.query({url:['https://jobsatamazon.co.uk/*','https://*.jobsatamazon.co.uk/*']});
    search=matches.find(t=>isAmazonSearch(t.url));
  }
  if(!search)return {ok:false,error:'Open the Amazon Recommended job-search page first, then press Start.'};
  const cfg=await getSettings();
  if(manual&&cfg.refreshMode===SIGNAL_MODE_ORACLE)return {ok:false,error:'Manual refresh is disabled in Oracle Signal Only mode.'};
  const err=validateShiftSettings(cfg.shifts);
  if(err)return {ok:false,error:err};
  if(!validUrl(cfg.searchUrl))return {ok:false,error:'The saved job-search URL must use https://jobsatamazon.co.uk.'};
  if(cfg.refreshMode===SIGNAL_MODE_ORACLE){
    const error=validateReceiverConfig(await receiverConfig());if(error)return {ok:false,error};
    const journal=await signalJournal();
    if(journal.active)return {ok:false,error:'A previous receiver application was interrupted. Check the Amazon account manually, then use Reset before restarting receiver automation.'};
  }
  // A new Start must not immediately refresh a search page currently
  // blocked by a human verification screen.
  const preflight=await securityPreflight(search.id);
  if(!preflight.ok)return preflight;
  s={running:true,generation:Date.now(),phase:'search',phaseEntered:Date.now(),
    searchTabId:search.id,appTabId:null,candidateTabIds:[],applyStartedAt:null,
    config:cfg,triedKeys:[],triedSnapshots:{},missingTriedJobs:{},resultsSignature:'',resultsStableSince:0,currentJobKey:null,currentJobTargets:[],jobTargetIndex:0,jobDetailsStillSearch:false,retryCount:0,nextRefresh:null,lastRefreshDueAt:null,
    status:'Running — starting',changedAt:Date.now(),continued:false,hasAgreed:false,
    signalCycleActive:false,activeSignalId:null,pendingSignals:[],cycleEmptyAt:null,cycleEmptySignature:''};
  if(isOracle(s)){
    s.receiverId=(await receiverConfig()).receiverId||'';
    const journal=await signalJournal();
    s.pendingSignals=(journal.pending||[]).filter(x=>Number.isFinite(x.receivedAt)&&Date.now()-x.receivedAt<24*60*60*1000).slice(0,MAX_PENDING_SIGNALS);
  }
  // Scan the already-rendered Recommended cards first. Previously Start
  // forced a full page reload, delaying or losing an eligible visible job.
  // Subsequent FAST/SLOW refreshes still use the configured scheduler.
  status(s,isOracle(s)?'WAITING FOR ORACLE SIGNAL':'Running — checking visible Recommended job cards');
  await arm(s);await saveSession(s);
  if(!await enable(s.searchTabId,s)){
    s.running=false;status(s,'Could not initialise the job-search observer');
    await disarm();await saveSession(s);
    return {ok:false,error:s.status};
  }
  if(isOracle(s)){audit(s,'receiver_waiting',{outcome:'awaiting_signal'});const connected=await signalConnect(s);if(!connected.ok){await stop();return {ok:false,error:connected.error};}}
  return {ok:true,status:s.status};
}
// Mutation-driven observations handle normal transitions immediately. During a
// blocked stage, the adapter sends a liveness pulse every second. The alarm is
// a coarse backup only: MV3 service workers cannot promise sub-30s alarms.
async function scheduleWatchdog(s){
  if(!s?.running||s.phase==='search')return;
  await chrome.alarms.create('stage-watchdog',{when:Date.now()+30000});
  setTimeout(()=>ordered(async()=>{
    const fresh=await getSession();if(fresh?.running)await watchdog(fresh);
  }),STALLED_STAGE_GRACE_MS+50);
}
async function watchdog(s){
  if(!s.running||s.phase==='search')return;
  // A challenge may appear just before the observation callback. Catch it
  // before any fallback, tab closing or stuck-stage page reload.
  const ids=[s.appTabId,...(s.phase==='await_app'?(s.candidateTabIds||[]):[]),s.searchTabId];
  for(const id of new Set(ids)){
    if(!Number.isInteger(id))continue;
    const check=await msg(id,{type:'SECURITY_STATUS'});
    if(check?.loginRequired){s.securityTabId=id;await finalise(s,'login','Login required during stage recovery');return;}
    if(check?.blocked){s.securityTabId=id;await finalise(s,'security','Visible verification during stage recovery');return;}
  }
  const now=Date.now();
  if(now-s.phaseEntered<STALLED_STAGE_GRACE_MS)return;
  // A visible Step 2 is a valid stage, even when no eligible shifts exist.
  // The shift evaluator owns the no-qualifying-shift return branch.
  if(s.phase==='shift'&&s.lastStep2SeenAt>=s.phaseEntered){
    await msg(s.appTabId,{type:'SCAN'});
    return;
  }
  if(['return_logo','return_jobs','return_wait'].includes(s.phase)){
    // The logo can lead straight to search, or to a landing page with a
    // "See all jobs" link. If neither route progresses, use our already-owned
    // Recommended search tab. Never repeatedly reload the application page
    // to rediscover a menu that does not exist on this layout.
    const app=await chrome.tabs.get(s.appTabId).catch(()=>null);
    if(app?.status==='loading'&&now-s.phaseEntered<15000)return;
    if(s.lastObservedLoading&&now-s.phaseEntered<8000)return;
    await completeReturn(s);
    return;
  }
  // A click accepted by the DOM is not proof that Amazon opened job details.
  // If the same Recommended card remains visible after 3 seconds, first try
  // another clickable node of that very card. Never turn this into three
  // page reloads with a stale job_details state.
  if(s.phase==='job_details'&&s.jobDetailsStillSearch&&!s.lastObservedLoading){
    const targets=s.currentJobTargets||[];
    for(let i=(s.jobTargetIndex||0)+1;i<targets.length;i++){
      const attempt=await msg(s.searchTabId,{type:'CLICK',id:targets[i],label:'Job card alternative '+i,generation:s.generation});
      if(attempt?.ok){
        s.jobTargetIndex=i;s.phaseEntered=Date.now();
        status(s,`Job card did not open — trying click target ${i+1}/${targets.length}`);
        await saveSession(s);return;
      }
    }
    enter(s,'search','Job card did not open — checking other eligible jobs');
    s.jobDetailsStillSearch=false;s.currentJobTargets=[];
    await arm(s);await saveSession(s);
    await msg(s.searchTabId,{type:'SCAN'});
    return;
  }
  if(s.phase==='await_app'&&!Number.isInteger(s.appTabId)){
    // Never reload Apply while Amazon is creating/verifying its own tab:
    // doing so can open duplicate application tabs. Allow its navigation to
    // finish, re-scan associated tabs, then stop safely on repeated failure.
    for(const id of s.candidateTabIds||[])if(await exists(id))await msg(id,{type:'SCAN'});
    if(now-s.phaseEntered<12000)return;
    s.retryCount++;
    if(s.retryCount>=3){await finalise(s,'failure','Amazon application tab could not be verified');return;}
    s.phaseEntered=now-11000;
    status(s,`Checking Amazon application tab (${s.retryCount}/3)`);
    await saveSession(s);return;
  }
  const tabId=searchPhase(s.phase)?s.searchTabId:s.appTabId;
  if(!await exists(tabId)){
    if(s.phase==='job_details'&&await exists(s.searchTabId)){
      enter(s,'search','Job details unavailable — checking remaining cards');
      await saveSession(s);await msg(s.searchTabId,{type:'SCAN'});return;
    }
    await finalise(s,'failure','Current controlled tab was lost');return;
  }
  let tab;
  try{tab=await chrome.tabs.get(tabId);}catch{return;}
  // A tab actively navigating or showing a verified loading indicator is not
  // stuck. Give it time to render; avoid destroying a slow successful load.
  if(tab.status==='loading'||s.lastObservedLoading){
    if(now-s.phaseEntered<15000)return;
  }
  // If page script hasn't delivered an observation after navigation, prompt
  // an immediate check first; do not assume the target is missing.
  if(!s.lastObservationAt||now-s.lastObservationAt>2100){
    await enable(tabId,s);await msg(tabId,{type:'SCAN'});
    if(now-s.phaseEntered<STALLED_STAGE_GRACE_MS)return;
  }
  if(s.retryCount>=3){await finalise(s,'failure','Expected stage: '+s.phase);return;}
  s.retryCount++;
  s.phaseEntered=now;
  s.lastObservationAt=0;s.lastObservedLoading=false;
  status(s,`Recovering ${s.phase}: refreshing page (${s.retryCount}/3)`);
  noteUnexpected(s,'Stage did not progress within recovery grace period','refresh');
  await saveSession(s);
  try{await chrome.tabs.reload(tabId);}catch(e){
    if(s.retryCount>=3)await finalise(s,'failure',`Could not reload ${s.phase}: ${String(e)}`);
  }
}
async function click(s,tabId,id,nextPhase,label){
  if(!s.running||!id||!Number.isInteger(tabId))return false;
  const result=await msg(tabId,{type:'CLICK',id,label,generation:s.generation});
  if(!result?.ok)return false;
  audit(s,'application_click_accepted',{source:label||'',outcome:'dom_click_accepted_not_stage_verified'});
  const previous=s.phase;
  if(nextPhase)enter(s,nextPhase,label);
  else {s.phaseEntered=Date.now();status(s,label);}
  if(previous==='job_details'&&nextPhase==='await_app'){
    s.applyStartedAt=Date.now();s.candidateTabIds=[];
    await disarm();s.nextRefresh=null;await msg(s.searchTabId,{type:'ARM_CLOCK',when:null});
  }
  await saveSession(s);
  if(nextPhase&&nextPhase!=='search')scheduleWatchdog(s);
  return true;
}
// The exclusion list is per job identity, not per refresh. An unavailable
// job must disappear from a stable, visibly populated Recommended result set
// before it can be tried after it reappears. Do not interpret navigation,
// skeletons, empty refresh placeholders or partial DOM churn as disappearance.
function reconcileTriedJobs(s,snap){
  // Each Oracle detection signal reopens the historical set, but a single
  // signal cycle never retries its own failed cards.
  if(isOracle(s))return;
  if(snap.activeRecommended!=='yes'||snap.loading||!snap.jobCards?.length||
     snap.recommendedResults===false)return;
  const now=Date.now();
  const signature=snap.jobCards.map(c=>c.key).join('||');
  if(s.resultsSignature!==signature){
    s.resultsSignature=signature;s.resultsStableSince=now;
  }
  s.missingTriedJobs??={};
  const visibleKeys=new Set(snap.jobCards.map(c=>c.key));
  for(const key of s.triedKeys||[]){
    if(visibleKeys.has(key)){delete s.missingTriedJobs[key];continue;}
    if(!s.missingTriedJobs[key])s.missingTriedJobs[key]=now;
  }
  // The card must remain absent while the same Recommended results are stable
  // for at least three seconds (a transient DOM update is insufficient).
  if(now-s.resultsStableSince>=3000){
    s.triedKeys=(s.triedKeys||[]).filter(key=>{
      if(!s.missingTriedJobs[key]||now-s.missingTriedJobs[key]<3000)return true;
      delete s.missingTriedJobs[key];delete (s.triedSnapshots||{})[key];return false;
    });
  }
  // An unchanged unsuccessful job remains excluded, even across refreshes.
  // Materially added visible card text creates a new eligible card version.
  for(const card of snap.jobCards){
    if(!(s.triedKeys||[]).includes(card.key))continue;
    const previous=s.triedSnapshots?.[card.key];
    if(!previous)continue;
    const added=addedCardText(previous,card.text);
    if(!added)continue;
    s.triedKeys=s.triedKeys.filter(x=>x!==card.key);
    s.triedSnapshots[card.key]=card.text;
    notify('previously_attempted_job_changed',{job_id:card.key,title:card.title||'',location:card.locationText||'',newly_added_text:added,card_text:card.text});
  }
}
async function handleSearch(s,snap){
  if(snap.noShifts){
    if(s.currentJobKey&&!s.triedKeys.includes(s.currentJobKey))s.triedKeys.push(s.currentJobKey);
    enter(s,'search','Unavailable shifts — trying next eligible job');
    await saveSession(s);
    if(!snap.isSearch){await msg(s.searchTabId,{type:'HISTORY_BACK'});return;}
  }
  if(s.phase==='job_details'){
    if(snap.buttons.apply){s.jobDetailsStillSearch=false;await click(s,s.searchTabId,snap.buttons.apply,'await_app','Applying — waiting for Amazon tab');return;}
    s.jobDetailsStillSearch=!!(snap.isSearch&&!snap.loading&&snap.jobCards.some(c=>c.key===s.currentJobKey));
    return;
  }
  if(!snap.isSearch){
    // Job card navigation may not have exposed a URL until the page rerenders.
    if(s.currentJobKey&&snap.buttons.apply){enter(s,'job_details','Job details');await handleSearch(s,snap);return;}
    return;
  }
  if(isOracle(s)&&(!s.signalCycleActive||s.signalAwaitingReload)){
    s.searchDiagnostics={view:snap.activeRecommended,visible:snap.jobCards.length,eligible:0,cardScanMs:snap.cardScanMs??null,observedAt:Date.now()};
    await saveSession(s);return;
  }
  reconcileTriedJobs(s,snap);
  const ranked=rankJobs(snap.jobCards,s.config);
  const signatureForAudit=snap.jobCards.map(c=>c.key).join('|')+'#'+ranked.length;
  if(isOracle(s)&&s.auditJobSignature!==signatureForAudit){s.auditJobSignature=signatureForAudit;audit(s,'job_cards_evaluated',{visible_jobs:snap.jobCards.length,eligible_jobs:ranked.length});}
  s.searchDiagnostics={view:snap.activeRecommended,visible:snap.jobCards.length,eligible:ranked.length,
    cardScanMs:snap.cardScanMs??null,
    keywords:[...(s.config.box1?.keywords||[]),...(s.config.box2?.enabled?s.config.box2.keywords:[])].join(', '),
    observedAt:Date.now()};
  if(snap.activeRecommended==='no'){
    if(snap.buttons.recommended)await click(s,s.searchTabId,snap.buttons.recommended,null,'Switching to Recommended');
    return;
  }
  if(snap.activeRecommended==='unknown'){
    status(s,`Waiting for Recommended detection · ${snap.jobCards.length} card(s) visible`);return;
  }
  const completed=isOracle(s)?((await chrome.storage.local.get('oracleCompletedJobs')).oracleCompletedJobs||[]):[];
  if(isOracle(s)){
    s.auditSkippedKeys??=[];
    for(const candidate of ranked){
      if(!s.triedKeys.includes(candidate.key)||s.auditSkippedKeys.includes(candidate.key))continue;
      s.auditSkippedKeys.push(candidate.key);
      audit(s,'job_already_attempted_same_signal',{job_key:candidate.key,decision:'skip',reason:'Already attempted in this signal cycle'});
    }
  }
  const chosen=ranked.find(c=>!s.triedKeys.includes(c.key)&&!completed.includes(c.key));
  if(chosen){
    s.cycleEmptyAt=null;s.cycleEmptySignature='';
    if(await click(s,s.searchTabId,chosen.id,'job_details','Click 1 — selected job card')){
      s.currentJobKey=chosen.key;s.currentJobTitle=chosen.title||'';s.currentJobLocation=chosen.locationText||'';
      audit(s,'job_selected',{job_key:chosen.key,outcome:'clicked'});
      s.triedSnapshots??={};s.triedSnapshots[chosen.key]=chosen.text;
      notify('job_selected',{...jobContext(s),title:s.currentJobTitle||'Not displayed',
        location:s.currentJobLocation||'Not displayed',card_text:chosen.text});
      s.currentJobTargets=chosen.targets||[chosen.id];
      s.jobTargetIndex=0;s.jobDetailsStillSearch=true;
      if(!s.triedKeys.includes(chosen.key))s.triedKeys.push(chosen.key);
      await saveSession(s);
    }
    return;
  }
  if(isOracle(s)&&s.signalCycleActive){
    const signature=snap.jobCards.map(c=>`${c.key}:${c.text||''}`).join('|');
    if(snap.loading||s.cycleEmptySignature!==signature){s.cycleEmptySignature=signature;s.cycleEmptyAt=Date.now();}
    if(shouldCompleteSignalCycle({mode:s.config.refreshMode,active:s.signalCycleActive,recommended:snap.activeRecommended,loading:snap.loading,availableCount:0,signature,firstEmptyAt:s.cycleEmptyAt})){
      if(ranked.length===0)audit(s,'no_matching_job',{visible_jobs:snap.jobCards.length,eligible_jobs:0});
      else audit(s,'all_eligible_jobs_exhausted',{visible_jobs:snap.jobCards.length,eligible_jobs:ranked.length});
      await enterSignalWaiting(s,ranked.length===0?'No matching configured job card':'All matching job cards checked');
      await processPendingSignal(s);
    }else{status(s,'Oracle signal cycle — checking remaining cards');await saveSession(s);}
    return;
  }
  status(s,`Running—${isFast(ukParts(Date.now()),s.config)?'FAST':'SLOW'} · waiting for eligible cards`);
  await saveSession(s);
}
async function handleApp(s,snap){
  // Amazon can navigate directly to /no-available-shift before ever rendering
  // Step 2 or a shift card. Treat this as a normal no-shift outcome, not a
  // missing-button recovery failure. Never click Submit shift preferences.
  if(snap.noShiftPage&&['next','start','after_start','shift','shift_detail'].includes(s.phase)){
    audit(s,'no_shift_cards',{outcome:'confirmed_no_shift_page'});
    newShiftVisit(s);finishShiftVisit(s,'Amazon no-available-shifts page');
    enter(s,'return_logo','No shift cards available — returning to Recommended');
    await saveSession(s);
    await handleApp(s,snap);return;
  }
  if(s.phase==='prehire'&&snap.prehire){
    await finalise(s,'success','Visible Schedule pre-hire appointment');return;
  }
  switch(s.phase){
    case 'next': if(snap.buttons.next){await click(s,s.appTabId,snap.buttons.next,'start','Click 3 — Next');}break;
    case 'start': if(snap.buttons.start){await click(s,s.appTabId,snap.buttons.start,'after_start','Click 4 — Start Application');}break;
    case 'after_start':
      // Step 2 may be rendered without a heading or after a page reload.
      // Its visible progress label is authoritative once the user has
      // advanced through the application opening sequence.
      if(snap.step2){
        enter(s,'shift','Step 2 of 6 — evaluating shifts');newShiftVisit(s);
        await saveSession(s);await handleApp(s,snap);break;
      }
      if(snap.buttons.continue&&!s.continued){
        s.continued=true;await click(s,s.appTabId,snap.buttons.continue,null,'Click 5 — Continue');
      } else if(snap.buttons.agree){
        s.hasAgreed=true;await click(s,s.appTabId,snap.buttons.agree,'shift','Click 6 — I Agree');
        await chrome.alarms.create('shift-eval',{when:Date.now()+30000});
      }
      break;
    case 'shift':{
      if(!snap.step2)return;
      collectShiftCards(s,snap.shiftCards);
      s.lastStep2SeenAt=Date.now();
      const signature=JSON.stringify(snap.shiftCards.map(c=>[c.key,c.weeklyHours,c.workingDays,c.startTime]));
      if(!s.shiftSeenAt)s.shiftSeenAt=Date.now();
      if(s.shiftSignature!==signature){s.shiftSignature=signature;s.shiftLastChanged=Date.now();}
      const best=rankShifts(snap.shiftCards,s.config.shifts)[0];
      if(best){if(await click(s,s.appTabId,best.id,'shift_detail','Click 7 — selected matching shift')){audit(s,'shift_selected',{shift_key:best.key,outcome:'clicked'});finishShiftVisit(s,'Qualifying shift selected',best.key);}break;}
      const now=Date.now();
      // A rendered list with ineligible shifts needs only a one-second
      // stability interval. A totally unrecognised list gets a longer grace
      // period so asynchronous cards are not mistaken for no shifts.
      const ready=snap.shiftListReady||snap.shiftCards.length>0;
      const grace=snap.loading?8000:ready?1000:4000;
      if(now-s.shiftSeenAt>=grace&&now-s.shiftLastChanged>=1000){
        audit(s,'no_suitable_shifts',{shift_count:s.shiftVisit?.cards?.length||0});
        finishShiftVisit(s,'No qualifying shift meets configured preferences');
        enter(s,'return_logo','No qualifying shift — opening Amazon Jobs home');
        await saveSession(s);await handleApp(s,snap);
      }else{
        status(s,'Checking shifts — no qualifying match yet');await saveSession(s);
        // The page adapter pulses once a second, including when no DOM
        // mutation occurs; a coarse alarm survives worker suspension.
        await chrome.alarms.create('shift-eval',{when:now+30000});
      }
      break;
    }
    case 'shift_detail': if(snap.buttons.selectJob){await click(s,s.appTabId,snap.buttons.selectJob,'offer','Click 8 — Select this job');}break;
    case 'offer': if(snap.buttons.acceptOffer){await click(s,s.appTabId,snap.buttons.acceptOffer,'offer_next','Click 9 — Accept Offer');}break;
    case 'offer_next': if(snap.buttons.next){await click(s,s.appTabId,snap.buttons.next,'prehire','Click 10 — Next');}break;
    case 'return_logo':
      if(snap.isSearch){await completeReturn(s);break;}
      if(snap.buttons.homeLogo){
        await click(s,s.appTabId,snap.buttons.homeLogo,'return_jobs','Click 7A — Amazon Jobs logo');
      }
      // If the logo is temporarily unavailable, the watchdog safely falls
      // back to the already-owned search tab after the three-second grace.
      break;
    case 'return_jobs':
      if(snap.isSearch){await completeReturn(s);break;}
      if(snap.buttons.seeAllJobs){
        if(await click(s,s.appTabId,snap.buttons.seeAllJobs,'return_wait','Click 8A — See all jobs')){
          await chrome.alarms.create('return-to-search',{when:Date.now()+30000});
        }
      }
      break;
    case 'return_wait':
      if(snap.isSearch)await completeReturn(s);
      break;
  }
}
async function completeReturn(s){
  if(!s?.running||!['return_logo','return_jobs','return_wait'].includes(s.phase))return;
  // Follow the Amazon Jobs logo navigation when available, then reuse the original controlled search tab.
  // Do not accumulate abandoned application tabs or reselect the rejected job.
  const oldApp=s.appTabId;s.appTabId=null;s.candidateTabIds=[];s.continued=false;s.hasAgreed=false;
  audit(s,'returned_to_search',{outcome:'checking_remaining_jobs'});
  enter(s,'search','Returned to Recommended — checking other jobs');
  if(!await exists(s.searchTabId))await recoverSearchTab(s);
  if(await exists(s.searchTabId)){
    const tab=await chrome.tabs.get(s.searchTabId);
    if(!isAmazonSearch(tab.url))await chrome.tabs.update(s.searchTabId,{url:s.config.searchUrl});
    await arm(s);await enable(s.searchTabId,s);
    await msg(s.searchTabId,{type:'SCAN'});
  }
  if(await exists(oldApp))await chrome.tabs.remove(oldApp).catch(()=>{});
  if(isOracle(s)&&!s.signalCycleActive){await enterSignalWaiting(s);await processPendingSignal(s);}
  await saveSession(s);
}
async function handleObservation(s,tabId,snap){
  if(!s?.running)return;
  if(tabId===s.searchTabId){
    if(!searchPhase(s.phase))return;
    if(!/^https:\/\//.test(snap.url))return;
    if(snap.loginRequired){audit(s,'login_detected');s.securityTabId=tabId;await finalise(s,'login','Amazon login detected on job search');return;}
    if(snap.publicJobSearch){
      // React can briefly show the generic public search shell during page
      // navigation. Require it to remain visible across a liveness pulse
      // before declaring the Recommended session lost. Do not click or reload
      // the page while verification is pending.
      if(!s.publicSearchFirstSeenAt)s.publicSearchFirstSeenAt=Date.now();
      if(Date.now()-s.publicSearchFirstSeenAt<1000){
        status(s,'Checking sign-in — public job search displayed');
        return;
      }
      s.securityTabId=tabId;
      await finalise(s,'login','Recommended disappeared and public jobs-found search is displayed; check your Amazon sign-in');return;
    }
    s.publicSearchFirstSeenAt=0;
    if(snap.securityBlocked){audit(s,'human_verification_detected');s.securityTabId=tabId;await finalise(s,'security','Active human verification on job search');return;}
    s.lastObservationAt=Date.now();s.lastObservedLoading=!!snap.loading;
    if(s.phase==='job_details'&&snap.noShifts) {await handleSearch(s,snap);return;}
    await handleSearch(s,snap);
    return;
  }
  if(s.phase==='await_app'&&s.candidateTabIds.includes(tabId)){
    // This opener-verified candidate can show a human-verification page
    // BEFORE its Amazon application URL or Step 2 markers are available.
    if(snap.loginRequired){s.securityTabId=tabId;await finalise(s,'login','Amazon login detected in application tab');return;}
    if(snap.securityBlocked){s.securityTabId=tabId;await finalise(s,'security','Visible manual security check in Amazon-created tab');return;}
    if(!snap.appEvidence)return;
    // Association is supplied only by tabs.onCreated(openerTabId == controlled search tab).
    s.appTabId=tabId;s.candidateTabIds=[];s.continued=false;
    enter(s,'next','Verified Amazon-created application tab');await saveSession(s);
  }
  if(tabId!==s.appTabId||!appPhase(s.phase))return;
  s.lastObservationAt=Date.now();s.lastObservedLoading=!!snap.loading;
  if(snap.step2)s.lastStep2SeenAt=Date.now();
  if(snap.loginRequired){s.securityTabId=tabId;await finalise(s,'login','Amazon login detected on application');return;}
  if(snap.securityBlocked){s.securityTabId=tabId;await finalise(s,'security','Active human verification on application');return;}
  await handleApp(s,snap);
}
async function due(s,requestedTime){
  if(!s?.running||isOracle(s)||!searchPhase(s.phase)||!s.nextRefresh)return;
  const slot=s.nextRefresh.when,now=Date.now();
  if(Math.abs(requestedTime-slot)>10||now<slot-1000)return;
  if(s.lastRefreshDueAt===slot)return;
  // Preferences edited while running are activated at this scheduled refresh only.
  const newConfig=await getSettings();
  if(validateShiftSettings(newConfig.shifts)){
    status(s,'Settings invalid — correct shift hours and restart');s.running=false;await disarm();await saveSession(s);return;
  }
  s.config=newConfig;
  await refresh(s,slot);
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  // These internal offscreen commands are handled only by offscreen.js;
  // the worker must not race its durable delivery acknowledgements.
  if(['AUDIO_BEEP','AUDIO_STOP','ORACLE_SIGNAL_CONNECT','ORACLE_SIGNAL_DISCONNECT','ORACLE_SIGNAL_PING','ORACLE_SIGNAL_TEST'].includes(message?.type))return false;
  ordered(async()=>{
    if(message?.type==='COMMAND'){
      if(message.command==='START')return await start(false);
      if(message.command==='MANUAL_REFRESH')return await start(true);
      if(message.command==='STOP')return await stop();
      if(message.command==='RESET')return await resetSession();
      if(message.command==='STATUS')return {ok:true,session:await getSession()};
      if(message.command==='RELAY_CONFIGURE'){const relay=await configureRelay(message.relay||{});await syncStatusAlarm();return {ok:true,relay};}
      if(message.command==='RELAY_STATUS')return {ok:true,relay:await relayPublicStatus()};
      if(message.command==='RELAY_STATUS_INTERVAL'){
        const enabled=!!message.enabled;
        await chrome.storage.local.set({relayStatusEnabled:enabled});
        await syncStatusAlarm();
        return {ok:true,relay:await relayPublicStatus()};
      }
      if(message.command==='RELAY_TEST')return await testRelay(statusSnapshot(await getSession()));
      if(message.command==='ORACLE_SIGNAL_CONFIG'){
        const old=await receiverConfig();const proposed={endpoint:message.config?.endpoint||RECEIVER_ENDPOINT,receiverId:message.config?.receiverId||'',credential:message.config?.credential||old.credential||''};
        const error=validateReceiverConfig(proposed);if(error)return {ok:false,error};
        await chrome.storage.local.set({[SIGNAL_CONFIG_KEY]:proposed});
        const session=await getSession();if(session?.running&&isOracle(session))await signalConnect(session);
        return {ok:true,receiver:await receiverPublicStatus()};
      }
      if(message.command==='ORACLE_SIGNAL_REMOVE'){
        await chrome.storage.local.remove(SIGNAL_CONFIG_KEY);await signalDisconnect();
        const session=await getSession();if(session?.running&&isOracle(session)){status(session,'Oracle receiver credentials removed — stopped');session.running=false;await saveSession(session);}
        return {ok:true};
      }
      if(message.command==='ORACLE_SIGNAL_STATUS')return {ok:true,receiver:await receiverPublicStatus()};
      if(message.command==='ORACLE_AUDIT_STATUS')return {ok:true,audit:await receiverAudit.status()};
      if(message.command==='ORACLE_SIGNAL_TEST'){
        const config=await receiverConfig(),error=validateReceiverConfig(config);
        if(error)return {ok:false,error};
        try{await ensureOffscreenDocument();
          let result=null;for(let i=0;i<4;i++){
            result=await chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_TEST',config}).catch(()=>null);
            if(result)break;if(i<3)await new Promise(r=>setTimeout(r,200));
          }return result||{ok:false,error:'Receiver connection test did not respond'};
        }catch{return {ok:false,error:'Could not start receiver connection test'};}
      }
      if(message.command==='SETTINGS_SAVED'){
        const mode=(await getSettings()).refreshMode;
        const switched=await switchRefreshMode(mode);
        if(!switched.ok)return switched;
        return {ok:true,note:mode===SIGNAL_MODE_ORACLE?'Oracle Signal Only mode selected':'Built-in refresh mode selected'};
      }
    }
    if(message?.type==='ORACLE_SIGNAL_STATE'||message?.type==='ORACLE_SIGNAL_EVENT'){
      if(sender.url!==chrome.runtime.getURL('offscreen.html'))return {ok:false,error:'Untrusted signal sender'};
      if(message.type==='ORACLE_SIGNAL_STATE'){
        const session=await getSession();
        if(!session?.running||!isOracle(session))return {ok:true,ignored:true};
        const state=message.status||{};
        await chrome.storage.session.set({[SIGNAL_STATUS_KEY]:{state:String(state.state||'unknown').slice(0,40),connected:state.connected===true,at:Date.now(),error:String(state.error||'').slice(0,160),lastAck:state.lastAck||null}});
        if(session.auditLastSocketState!==state.state){session.auditLastSocketState=state.state;audit(session,'receiver_connection_state',{outcome:state.state||'unknown'});await saveSession(session);}
        if(state.connected===true&&!session.signalCycleActive&&session.phase==='search'&&session.pendingSignals?.length)await processPendingSignal(session);
        return {ok:true};
      }
      return await acceptSignal(message.signal);
    }
    const s=await getSession();
    if(message?.type==='OBSERVATION'&&sender.tab?.id===s?.searchTabId||message?.type==='OBSERVATION'&&s?.candidateTabIds?.includes(sender.tab?.id)||message?.type==='OBSERVATION'&&sender.tab?.id===s?.appTabId){
      await handleObservation(s,sender.tab.id,message.snapshot);await saveSession(s);return {ok:true};
    }
    if(message?.type==='CLOCK_DUE'&&sender.tab?.id===s?.searchTabId){await due(s,message.dueAt);return {ok:true};}
    if(message?.type==='WATCH_TICK'&&s?.running&&message.generation===s.generation){
      const expected=appPhase(s.phase)?(s.appTabId??s.searchTabId):s.searchTabId;
      if(sender.tab?.id===expected){
        if(isOracle(s)&&s.phase==='search'&&s.signalCycleActive&&s.cycleEmptyAt)await msg(s.searchTabId,{type:'SCAN'});
        if(s.phase==='shift')await msg(s.appTabId,{type:'SCAN'});
        if(s.phase==='search'&&(s.publicSearchFirstSeenAt||Object.keys(s.missingTriedJobs||{}).length))
          await msg(s.searchTabId,{type:'SCAN'});
        await watchdog(s);
      }
      return {ok:true};
    }
    return {ok:false};
  }).then(reply,e=>reply({ok:false,error:String(e)}));return true;
});
chrome.tabs.onCreated.addListener(tab=>ordered(async()=>{
  const s=await getSession();
  if(s?.running&&s.phase==='await_app'&&tab.openerTabId===s.searchTabId&&Date.now()-s.applyStartedAt<25000){
    s.candidateTabIds.push(tab.id);await saveSession(s);
    await enable(tab.id,s);
  }
}));
chrome.tabs.onUpdated.addListener((id,info,tab)=>{
  if(info.status!=='complete')return;
  ordered(async()=>{
    const s=await getSession();if(!s?.running)return;
    if(id===s.searchTabId||id===s.appTabId||s.candidateTabIds.includes(id)){
      if(id===s.searchTabId&&(!validUrl(tab.url)||(s.phase==='search'&&!isAmazonSearch(tab.url)))){
        await finalise(s,'navigation','Search page unexpectedly left Recommended; sign in manually if logged out');return;
      }
      if(id===s.searchTabId&&isOracle(s)&&s.signalAwaitingReload){s.signalAwaitingReload=false;await saveSession(s);}
      await enable(id,s);
    }
  });
});
chrome.tabs.onRemoved.addListener(id=>ordered(async()=>{
  const s=await getSession();if(!s?.running)return;
  if(id===s.appTabId){
    s.appTabId=null;s.candidateTabIds=[];enter(s,'search','Application tab closed — resuming search');
    if(await exists(s.searchTabId)){
      const tab=await chrome.tabs.get(s.searchTabId);
      if(!isAmazonSearch(tab.url))await chrome.tabs.update(s.searchTabId,{url:s.config.searchUrl});
      await arm(s);await saveSession(s);await enable(s.searchTabId,s);
    }else{await recoverSearchTab(s);await arm(s);await saveSession(s);}
  }else if(id===s.searchTabId){
    if(isOracle(s)){audit(s,'search_tab_lost');await finalise(s,'navigation','The controlled Recommended search tab was closed; reopen it manually');return;}
    await recoverSearchTab(s);if(searchPhase(s.phase))await arm(s);
    await saveSession(s);
  }else if(s.candidateTabIds.includes(id)){s.candidateTabIds=s.candidateTabIds.filter(x=>x!==id);await saveSession(s);}
}));
chrome.alarms.onAlarm.addListener(alarm=>ordered(async()=>{
  if(alarm.name==='relay-flush'){await flushRelayQueue();return;}
  if(alarm.name===STATUS_ALARM){await sendStatusHeartbeat();return;}
  if(alarm.name===SIGNAL_HEALTH_ALARM){
    const run=await getSession();
    if(run?.running&&isOracle(run)){
      if(run.signalAwaitingReload&&Date.now()-run.phaseEntered>60000){
        await enterSignalWaiting(run,'Search reload did not complete; no automatic retry');
      }
      try{await ensureOffscreenDocument();const pong=await chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_PING'}).catch(()=>null);if(!pong?.ok||!pong.status?.configured)await signalConnect(run);}
      catch{await signalConnect(run);}
    }else await signalDisconnect();
    return;
  }
  if(alarm.name==='beep'){
    const x=(await chrome.storage.session.get('beepState')).beepState;
    if(!x||x.remaining<=0){await chrome.alarms.clear('beep');return;}
    await beepOnce();x.remaining--;await chrome.storage.session.set({beepState:x});
    if(!x.remaining)await chrome.alarms.clear('beep');return;
  }
  const s=await getSession();if(!s?.running)return;
  if(alarm.name==='job-refresh'){await due(s,s.nextRefresh?.when);return;}
  if(alarm.name==='stage-watchdog'){await watchdog(s);return;}
  if(alarm.name==='shift-eval'&&s.phase==='shift'){await msg(s.appTabId,{type:'SCAN'});return;}
  if(alarm.name==='return-to-search'&&s.phase==='return_wait'){await completeReturn(s);return;}
}));
async function restrictSecretStorage(){
  // The adapter runs as an untrusted content script and must not read local
  // credentials; only the background worker and popup require them.
  try{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});}catch(e){console.warn('Could not restrict storage access level:',e);}
}
chrome.runtime.onInstalled.addListener(()=>ordered(async()=>{
  await restrictSecretStorage();
  const {settings}=await chrome.storage.local.get('settings');
  // Upgrade in place without dropping saved keywords, modes, shift preferences or refresh times.
  const migrated=normaliseSettings(settings);
  await chrome.storage.local.set({settings:migrated});
  await syncStatusAlarm();
  void flushRelayQueue().catch(()=>{});
}));
chrome.runtime.onStartup.addListener(()=>ordered(async()=>{
  await restrictSecretStorage();
  await chrome.alarms.clearAll();await chrome.storage.session.clear();
  await syncStatusAlarm();
  void flushRelayQueue().catch(()=>{});
}));
