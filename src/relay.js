/* Non-blocking delivery to the user's self-hosted Telegram relay.
 * Only the MV3 background service worker can call this module. No Telegram
 * bot token or Amazon credential is included in a notification. */
import {buildRelayEvent,RelayPayloadError} from './relay_schema.js';
export const RELAY_URL='https://145-241-233-33.sslip.io/v1/events';
const CONF='relayConfig', QUEUE='relayPending', META='relayDeliveryState';
const HEARTBEAT_SETTING='relayStatusEnabled';
const MAX_QUEUE=450, MAX_QUEUE_STORAGE_BYTES=4000000, RETENTION_MS=24*60*60*1000, MAX_BYTES=675000;
let inflight=null;
let writeChain=Promise.resolve();
function withQueue(mutator){
  const operation=writeChain.then(async()=>{
    const original=(await chrome.storage.local.get(QUEUE))[QUEUE]||[];
    const updated=await mutator(original);
    await chrome.storage.local.set({[QUEUE]:updated});return updated;
  });
  writeChain=operation.catch(()=>{});return operation;
}
const now=()=>Date.now();
const clean=v=>typeof v==='string'?v.slice(0,4000):v;
function redacted(v, depth=0){
  if(depth>7)return null;
  if(Array.isArray(v))return v.slice(0,250).map(x=>redacted(x,depth+1));
  if(v&&typeof v==='object'){
    const o={};for(const [key,value] of Object.entries(v)){
      if(/password|cookie|token|api.?key|authorization|session.?id|access.?key|email|phone|applicant|first.?name|last.?name|date.?of.?birth|address.?line|postcode.?home/i.test(key))continue;
      o[key]=redacted(value,depth+1);
    }return o;
  }
  return clean(v);
}
export const getRelayConfig=async()=>{
  const c=(await chrome.storage.local.get(CONF))[CONF]||{};
  return {enabled:!!c.enabled,apiKey:String(c.apiKey||'')};
};
export const relayPublicStatus=async()=>{
  const c=await getRelayConfig(),x=await chrome.storage.local.get([QUEUE,META,HEARTBEAT_SETTING]);
  return {enabled:c.enabled,configured:!!c.apiKey,statusEnabled:!!x[HEARTBEAT_SETTING],pending:(x[QUEUE]||[]).length,
    lastResult:x[META]?.lastResult||'Not tested',lastDelivery:x[META]?.lastDelivery||null};
};
async function setState(lastResult,delivered=false){
  const old=(await chrome.storage.local.get(META))[META]||{};
  await chrome.storage.local.set({[META]:{...old,lastResult,lastDelivery:delivered?new Date().toISOString():old.lastDelivery}});
}
async function scheduleRetry(delayMs=60000){
  await chrome.alarms.create('relay-flush',{when:now()+Math.max(1500,delayMs)});
}
export async function enqueueRelayEvent(type,data,options={}){
  // Disabled notifications must not silently create a local job/shift history.
  const conf=await getRelayConfig();
  if(!conf.enabled||!conf.apiKey)return null;
  let event;
  try{event=buildRelayEvent(type,redacted(data),options);}
  catch(error){
    // Invalid events never reach the server or enter the persistent retry queue.
    await setState(error instanceof RelayPayloadError?error.message:`Cannot build ${type} relay event`);
    return null;
  }
  if(new TextEncoder().encode(JSON.stringify(event)).byteLength>MAX_BYTES){
    await setState('Event exceeds local 675 KB safety limit; not queued');return null;
  }
  // The durable queue is the source of truth, including while offline or
  // across MV3 service worker restarts. Same event UUID retained on retries.
  const viable=await withQueue(old=>{
    const fresh=old.filter(item=>now()-item.addedAt<RETENTION_MS);
    if(!fresh.some(item=>item.event.event_id===event.event_id)){
      const urgent=['account_logged_out','human_verification','automation_error','automation_stopped','prehire_appointment'];
      const significant=['shift_visit_completed','no_shift_cards','no_suitable_shifts','shift_selection_result'];
      const priority=urgent.includes(type)?100:significant.includes(type)?50:0;
      fresh.push({event,priority,addedAt:now(),attempts:0,nextAt:now()});
      fresh.sort((a,b)=>(b.priority||0)-(a.priority||0)||a.addedAt-b.addedAt);
    }
    while(fresh.length>MAX_QUEUE||new TextEncoder().encode(JSON.stringify(fresh)).byteLength>MAX_QUEUE_STORAGE_BYTES){
      // Remove lowest-priority oldest item under pressure, keeping urgent alerts.
      fresh.pop();
    }
    return fresh;
  });
  if(viable.length>=MAX_QUEUE)await setState('Relay queue at capacity; oldest undelivered events may expire');
  void flushRelayQueue().catch(()=>{});
  return event.event_id;
}
async function responseDetail(resp){
  // The relay currently returns a short generic FastAPI detail. Do not show
  // echoed request data, HTTP headers, saved keys or arbitrary response bodies.
  try{
    const raw=await resp.text();
    if(raw.length>8192)return '';
    const detail=JSON.parse(raw)?.detail;
    return typeof detail==='string'?detail.replace(/[\r\n\t]/g,' ').slice(0,180):'';
  }catch{return '';}
}
async function sendEvent(event,apiKey){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
  try{
    const resp=await fetch(RELAY_URL,{method:'POST',headers:{
      'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
      body:JSON.stringify(event),signal:abort.signal,cache:'no-store'});
    let receipt=null;
    if(resp.status===202){
      try{const payload=JSON.parse((await resp.text()).slice(0,512));
        if(payload?.status==='queued'||payload?.status==='duplicate')receipt=payload.status;
      }catch{/* Some clients and tests return empty acknowledgements. */}
    }
    return {code:resp.status,receipt,detail:resp.status===202?'':await responseDetail(resp),
      retryAfter:resp.headers?.get?.('Retry-After')||null};
  }finally{clearTimeout(timer);}
}
function retryAfter(header){
  if(!header)return null;
  const seconds=Number(header);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);
  const stamp=Date.parse(header);return Number.isFinite(stamp)?Math.max(1000,stamp-now()):null;
}
async function flushInternal(){
  const conf=await getRelayConfig();
  if(!conf.enabled||!conf.apiKey)return {ok:false,reason:'Relay disabled or API key not saved'};
  // Upgrade queued legacy v1.3.1 payloads without changing UUID/timestamp.
  // Unrecoverable, locally invalid payloads cannot be delivered as-is.
  let rejected=0;
  const queue=await withQueue(old=>old.filter(x=>now()-x.addedAt<RETENTION_MS).flatMap(x=>{
    try{return [{...x,event:buildRelayEvent(x.event.event_type,redacted(x.event.data),{
      event_id:x.event.event_id,occurred_at:x.event.occurred_at})}];}
    catch{rejected++;return [];}
  }));
  if(rejected)await setState(`${rejected} old relay event(s) removed: invalid payload/schema; current events use relay v2`);
  if(!queue.length)return {ok:rejected===0,sent:0,pending:0};
  const item=queue[0];
  if(item.nextAt>now()){await scheduleRetry(item.nextAt-now());return {ok:true,sent:0,pending:queue.length};}
  let code=0,wait=0,permanent=false;
  try{
    const result=await sendEvent(item.event,conf.apiKey);
    code=result.code;
    if(code===202){await setState(`Accepted by relay: ${item.event.event_type} (HTTP 202${result.receipt?`, ${result.receipt}`:''})`,true);}
    else if(code===401||code===403){wait=60000;await setState(`Relay authorization/origin rejected (HTTP ${code}); verify saved key and existing CORS allowlist`);}
    else if(code===413||code===422){
      permanent=true;
      if(code===422&&item.event.event_type==='automation_status'){
        // Legacy Oracle v2 has only 12 event types; pause heartbeat until
        // the optional compatibility patch has been installed explicitly.
        await chrome.storage.local.set({[HEARTBEAT_SETTING]:false});
        await chrome.alarms.clear('relay-status');
        await setState('20-minute status updates paused (HTTP 422). Install the supplied relay status compatibility patch, then re-enable status updates.');
      }else await setState(`Relay rejected ${item.event.event_type} (HTTP ${code})${result.detail?`: ${result.detail}`:''}; not retried`);
    }
    else if(code===429){wait=retryAfter(result.retryAfter)||60000;await setState('Relay rate limited (HTTP 429); retry scheduled');}
    else{wait=code===503?30000:60000;await setState(`Relay HTTP ${code}${result.detail?`: ${result.detail}`:''}; retry scheduled`);}
  }catch(e){wait=30000;await setState(`Relay unreachable (${e?.name==='AbortError'?'timeout':'network error'}); retrying`);}
  if(code===202||permanent){
    const remaining=await withQueue(q=>q.filter(x=>x.event.event_id!==item.event.event_id));
    if(remaining.length)await scheduleRetry(1250);
    return {ok:code===202,sent:code===202?1:0,pending:remaining.length};
  }
  const nextTime=now()+Math.max(wait||10000,Math.min(600000,5000*2**Math.min(item.attempts+1,6)));
  await withQueue(q=>q.map(x=>x.event.event_id===item.event.event_id?{...x,attempts:x.attempts+1,nextAt:nextTime}:x));
  await scheduleRetry(nextTime-now());return {ok:false,sent:0,pending:queue.length,status:code};
}
export function flushRelayQueue(){
  if(inflight)return inflight;
  inflight=flushInternal().finally(()=>{inflight=null;});return inflight;
}
export async function configureRelay({enabled,apiKey}){
  const previous=await getRelayConfig();
  const key=apiKey===undefined?previous.apiKey:String(apiKey||'').trim();
  await chrome.storage.local.set({[CONF]:{enabled:!!enabled,apiKey:key}});
  if(enabled&&key)void flushRelayQueue().catch(()=>{});
  return await relayPublicStatus();
}
export async function testRelay(snapshot={}){
  const conf=await getRelayConfig();
  if(!conf.enabled||!conf.apiKey)return {ok:false,error:'Enable the relay and save its API key first'};
  // Oracle v2 fingerprint dedup uses event type + data; event_id and time alone
  // do not distinguish manual tests. Every click therefore changes data.reason.
  const testId=crypto.randomUUID();
  const clickedAt=new Date().toISOString();
  const state=['running','stopped','paused','completed'].includes(snapshot?.state)?snapshot.state:'unknown';
  const stage=String(snapshot?.stage||'unknown').replace(/[^A-Za-z0-9_ -]/g,'').slice(0,60);
  const event=buildRelayEvent('automation_stopped',{
    stage:'relay_test',reason:`TEST ONLY - Telegram connection check | Extension: ${state.toUpperCase()} | Stage: ${stage} | Test ID: ${testId} | Clicked: ${clickedAt}`
  },{event_id:crypto.randomUUID(),occurred_at:clickedAt});
  try{
    const r=await sendEvent(event,conf.apiKey);
    if(r.code===202){
      const label=r.receipt==='queued'?'Test queued by relay (HTTP 202)':
        r.receipt==='duplicate'?'Test duplicate: relay suppressed the message (HTTP 202)':
        'Test accepted (HTTP 202); relay receipt status unavailable';
      await setState(label,r.receipt==='queued');
      return {ok:true,accepted:true,httpStatus:202,receipt:r.receipt,eventId:event.event_id,testId};
    }
    const guidance=r.code===401?'Saved relay API key was rejected':
      r.code===403?'Extension origin/permission rejected by the relay':
      r.code===413?'Test request exceeded relay size limit':
      r.code===422?'Test payload rejected by relay schema':
      r.code===429?'Relay is rate limiting tests; retry later':
      r.code===503?'Relay queue is temporarily unavailable':'Relay returned an unexpected HTTP response';
    const error=`${guidance} (HTTP ${r.code})${r.detail?`: ${r.detail}`:''}`;
    await setState(error);
    return {ok:false,httpStatus:r.code,error};
  }catch(e){
    const error=e?.name==='AbortError'?'Relay test timed out':'Relay test failed (network unavailable)';
    await setState(error);return {ok:false,error};
  }
}
