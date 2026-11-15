/**
 * Receiver audit outbox v1. Local-only until a separately verified Stage 5D
 * transport and authentication schema is available. Nothing here posts to Oracle.
 *
 * The queue is bounded and failure-tolerant: event creation never awaits disk
 * writes or outbound Telegram, and no credentials, URLs or Amazon applicant
 * details are accepted as fields. Normal Mode does not call this module.
 */
export const RECEIVER_AUDIT_KEY='oracleReceiverAuditV1';
export const RECEIVER_AUDIT_SCHEMA=1;
export const RECEIVER_AUDIT_MAX_RECORDS=1200;
export const RECEIVER_AUDIT_MAX_BYTES=1_500_000;
export const RECEIVER_AUDIT_MAX_PENDING_WRITES=200;
export const RECEIVER_AUDIT_LOCAL_TTL_MS=7*24*60*60*1000;
export const ORACLE_AUDIT_UPLOAD_ENABLED=false;

const clean=(x,max=240)=>typeof x==='string'?x
  .replace(/[\u0000-\u001f\u007f]/g,' ')
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [REDACTED]')
  .replace(/(token|api[_-]?key|password|credential)\s*[:=]\s*[^\s;,]+/gi,'$1=[REDACTED]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[REDACTED-EMAIL]')
  .trim().slice(0,max):'';
const validNumber=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const utcISO=ms=>new Date(ms).toISOString();
const allowedFields=['signal_id','receiver_id','job_key','content_version','appearance_episode','state','phase','title','location',
  'visit_id','shift_key','shift_start_date','shift_end_date','shift_days','shift_time','shift_hours','shift_pay',
  'decision','reason','outcome','error_class','recovery_attempts','visible_jobs','eligible_jobs','shift_count','latency_ms',
  'source','ack_state','oracle_detected_at'];
const numberFields=new Set(['recovery_attempts','visible_jobs','eligible_jobs','shift_count','latency_ms','shift_hours']);
const maxField={title:180,location:220,reason:300,shift_days:100,shift_time:120,shift_pay:90};

/** Builds a versioned, sanitised event with an independently unique local ID. */
export function receiverAuditRecord(eventType,details={},time=Date.now(),id=crypto.randomUUID()){
  const at=Number.isFinite(time)?time:Date.now();
  const record={schema_version:RECEIVER_AUDIT_SCHEMA,event_id:id,at,occurred_at:utcISO(at),
    event_type:clean(eventType,80),delivery:{oracle_acknowledged:false}};
  for(const field of allowedFields){
    if(details[field]===undefined||details[field]===null)continue;
    const value=numberFields.has(field)?validNumber(details[field]):clean(details[field],maxField[field]||128);
    if(value!==null&&value!=='')record[field]=value;
  }
  return record;
}

export function compactAuditStore(previous,now=Date.now(),maxRecords=RECEIVER_AUDIT_MAX_RECORDS,maxBytes=RECEIVER_AUDIT_MAX_BYTES){
  const records=(Array.isArray(previous?.records)?previous.records:[])
    .filter(x=>x&&Number.isFinite(x.at)&&now>=x.at&&now-x.at<=RECEIVER_AUDIT_LOCAL_TTL_MS);
  let expired=Math.max(0,(Array.isArray(previous?.records)?previous.records.length:0)-records.length);
  let countDropped=0;
  while(records.length>maxRecords||JSON.stringify(records).length>maxBytes){records.shift();countDropped++;}
  return {schema_version:RECEIVER_AUDIT_SCHEMA,records,
    overflow_total:Math.max(0,previous?.overflow_total||0)+countDropped,
    expired_total:Math.max(0,previous?.expired_total||0)+expired,
    updated_at:now,upload_enabled:false};
}

export function createReceiverAudit({storage,now=()=>Date.now(),maxRecords=RECEIVER_AUDIT_MAX_RECORDS,maxBytes=RECEIVER_AUDIT_MAX_BYTES}={}){
  let tail=Promise.resolve();
  let writeFailures=0;
  let pendingWrites=0;
  let droppedPendingWrites=0;
  const persist=(fn)=>{
    const call=tail.then(fn).catch(error=>{writeFailures++;throw error;});
    tail=call.catch(()=>{}); // recover from quota errors; caller may inspect failure
    return call;
  };
  return {
    // Returns synchronously to avoid delaying job and shift actions.
    record(eventType,details={}){
      const entry=receiverAuditRecord(eventType,details,now());
      if(pendingWrites>=RECEIVER_AUDIT_MAX_PENDING_WRITES){
        droppedPendingWrites++;
        return {entry,dropped:true,pending:Promise.resolve(null)};
      }
      pendingWrites++;
      const pending=persist(async()=>{
        const existing=(await storage.get(RECEIVER_AUDIT_KEY))[RECEIVER_AUDIT_KEY]||{};
        const next=compactAuditStore({...existing,records:[...(existing.records||[]),entry]},now(),maxRecords,maxBytes);
        await storage.set({[RECEIVER_AUDIT_KEY]:next});
        return next;
      }).finally(()=>{pendingWrites--;});
      return {entry,pending,dropped:false};
    },
    status(){return persist(async()=>{
      const existing=(await storage.get(RECEIVER_AUDIT_KEY))[RECEIVER_AUDIT_KEY]||{};
      return compactAuditStore(existing,now(),maxRecords,maxBytes);
    }).then(s=>({count:s.records.length,overflow_total:s.overflow_total,expired_total:s.expired_total,
      upload_enabled:false,local_retention_hours:168,write_failures_since_restart:writeFailures,
      pending_writes:pendingWrites,dropped_pending_writes_since_restart:droppedPendingWrites,
      last_recorded_at:s.records.at(-1)?.at||null}));},
    waitForWrites(){return tail;}
  };
}

/** Serializer only. Deliberately no URL, API key or fetch transport. */
export function serializeFutureOracleAuditBatch(records){
  if(!Array.isArray(records))throw new TypeError('Audit batch must be a list');
  return {schema_version:RECEIVER_AUDIT_SCHEMA,events:records.map(x=>({...x}))};
}
