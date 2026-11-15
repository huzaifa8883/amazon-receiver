/* Oracle signal protocol helpers: pure and safe to use in Node tests. */
export const SIGNAL_MODE_BUILTIN='builtin';
export const SIGNAL_MODE_ORACLE='oracle';
export const MAX_PENDING_SIGNALS=40;
export const MAX_SEEN_SIGNALS=500;
export const SIGNAL_TTL_MS=24*60*60*1000;
// The production Oracle Stage 5E server sends signal_id (sig-N), job_id,
// content_version and detected_at but NOT event_id or detector_id.
// Retain compatibility with the original mock/legacy direct-event format.
export const EXISTING_ACTIONABLE_TYPES=Object.freeze(['new_job_detected','changed_job_detected','job_card_changed']);
export const FUTURE_ACTIONABLE_TYPES=Object.freeze(['job_reappeared']);
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function validSignalEndpoint(endpoint){
  if(typeof endpoint!=='string')return false;
  try{
    const u=new URL(endpoint);
    return u.protocol==='wss:' && Boolean(u.hostname) && !u.username && !u.password && !u.hash && !u.search && u.port!=='0';
  }catch{return false;}
}
export function validateReceiverConfig(c){
  if(!validSignalEndpoint(c?.endpoint))return 'Enter a valid wss:// Oracle broadcast endpoint (no URL credentials or query parameters).';
  if(!id.test(c?.receiverId||''))return 'Receiver ID must contain only letters, digits, dots, dashes, underscores or colons (up to 128 characters).';
  if(typeof c?.credential!=='string'||c.credential.length<12||c.credential.length>2048)return 'Enter the receiver-specific credential (at least 12 characters).';
  return null;
}
export function validateOracleSignal(input,{allowFutureEpisodes=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  if(!EXISTING_ACTIONABLE_TYPES.includes(input.type)&&!(allowFutureEpisodes&&FUTURE_ACTIONABLE_TYPES.includes(input.type)))return null;
  // Only the authenticated Oracle WebSocket may supply production frames.
  // The actual server's durable ID is sig-<positive integer>. It is also our
  // stable local dedup identity; do not invent a detector provenance field.
  const production=Object.hasOwn(input,'signal_id');
  if(production&&(!/^sig-[1-9][0-9]{0,18}$/.test(input.signal_id)||
      (input.event_id!==undefined&&input.event_id!==input.signal_id)))return null;
  const eventId=production?input.signal_id:input.event_id;
  if(!id.test(eventId||'')||!id.test(input.job_id||''))return null;
  if((!production||input.detector_id!==undefined)&&!id.test(input.detector_id||''))return null;
  if(typeof input.detected_at!=='string'||input.detected_at.length>40||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(input.detected_at))return null;
  const dt=Date.parse(input.detected_at);
  if(!Number.isFinite(dt)||Math.abs(Date.now()-dt)>7*24*60*60*1000)return null;
  const result={type:input.type,event_id:eventId,job_id:input.job_id,detected_at:new Date(dt).toISOString()};
  if(production)result.signal_id=input.signal_id;
  if(input.detector_id!==undefined)result.detector_id=input.detector_id;
  // Never change Oracle's verified version marker. Reappearance episodes can
  // be expressed as a fresh sig-N and/or a :reappeared:N content_version.
  for(const field of ['job_key','content_version','appearance_episode']){
    if(input[field]===undefined||input[field]===null)continue;
    if(typeof input[field]!=='string'||!id.test(input[field]))return null;
    result[field]=input[field];
  }
  return result;
}
export function trimSeenSignals(items,now=Date.now()){
  const out=[];const found=new Set();
  for(const x of (Array.isArray(items)?items:[])){
    if(!x||!id.test(x.id||'')||!Number.isFinite(x.at)||now-x.at>SIGNAL_TTL_MS||x.at>now+60000||found.has(x.id))continue;
    found.add(x.id);out.push({id:x.id,at:x.at});
  }
  return out.slice(-MAX_SEEN_SIGNALS);
}
export function enqueueSignal(pending,signal){
  const old=Array.isArray(pending)?pending:[];
  if(old.some(x=>x?.event_id===signal.event_id))return {queue:old,added:false};
  return {queue:[...old,signal].slice(-MAX_PENDING_SIGNALS),added:true};
}
export function signalRefreshAllowed(mode,cycleActive){return mode===SIGNAL_MODE_BUILTIN||Boolean(cycleActive);}
export function shouldCompleteSignalCycle({mode,active,recommended,loading,availableCount,signature,firstEmptyAt},now=Date.now()){
  if(mode!==SIGNAL_MODE_ORACLE||!active||recommended!=='yes'||loading||availableCount>0)return false;
  return typeof signature==='string'&&Number.isFinite(firstEmptyAt)&&now-firstEmptyAt>=1500;
}

// A new ACTIONABLE delivery ID opens a fresh eligibility cycle, including
// historically rejected cards and previously seen content/episode versions.
// A successful application and an identical delivery ID always remain blocked.
export function canBeginSignalCycle({signal,seenSignalIds=[],completedJobKeys=[]}={}){
  if(!signal||!id.test(signal.event_id||''))return false;
  if(seenSignalIds.includes(signal.event_id))return false;
  const jobKey=signal.job_key||signal.job_id;
  if(completedJobKeys.includes(jobKey)||completedJobKeys.includes(signal.job_id))return false;
  return true;
}
export function availabilityIdentity(signal){
  if(!signal)return null;
  return {signal_id:signal.event_id,job_key:signal.job_key||signal.job_id,
    content_version:signal.content_version||null,appearance_episode:signal.appearance_episode||null};
}
