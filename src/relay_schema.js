/* Strict client-side mapping for the Oracle relay v2 Pydantic models.
 * Grounded in the owner's supplied Amazon_Jobs_Relay_Backup/source/app.py.
 * Never spread internal controller data into a public API payload. */

export const RELAY_EVENT_TYPES=Object.freeze([
  'job_selected','previously_attempted_job_changed','shift_card_detected',
  'shift_selection_result','no_shift_cards','no_suitable_shifts',
  'automation_error','account_logged_out','human_verification',
  'prehire_appointment','automation_stopped','shift_visit_completed','automation_status'
]);
const TYPES=new Set(RELAY_EVENT_TYPES);
const DECISIONS=new Set(['selected','rejected','eligible','not_selected','unavailable','unknown']);
const RESULT_DECISIONS=new Set(['selected','rejected','eligible','not_selected','unavailable']);

export class RelayPayloadError extends Error {
  constructor(type,issue){super(`Invalid ${type} event: ${issue}`);this.name='RelayPayloadError';}
}
const text=(value,max)=>{
  if(value===null||value===undefined)return '';
  // These fields originate only from displayed job/shift text or controller status.
  return String(value).replace(/\bBearer\s+\S+/gi,'[redacted token]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[redacted email]')
    .replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
};
const originalCardText=(value,max)=>{
  if(value===null||value===undefined)return '';
  return String(value).replace(/\bBearer\s+\S+/gi,'[redacted token]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[redacted email]')
    .replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ')
    .slice(0,max);
};
function required(type,name,val,max){const x=text(val,max);if(!x)throw new RelayPayloadError(type,`missing required ${name}`);return x;}
function optional(obj,name,val,max){const x=text(val,max);if(x)obj[name]=x;}
function shortId(value){return text(value,100);}
function numberOrNull(value,min,max){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null;
}
function tokens(values,limit){return (Array.isArray(values)?values:[]).slice(0,limit).map(v=>text(v,100)).filter(Boolean);}
const DAY_NAMES=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DNAME={mon:'Mon',monday:'Mon',tue:'Tue',tues:'Tue',tuesday:'Tue',wed:'Wed',wednesday:'Wed',thu:'Thu',thur:'Thu',thurs:'Thu',thursday:'Thu',fri:'Fri',friday:'Fri',sat:'Sat',saturday:'Sat',sun:'Sun',sunday:'Sun'};
export function extractWorkingDays(record){
  if(Array.isArray(record.working_days))return tokens(record.working_days,7);
  const raw=String(record.shift_days||'');
  // Recognise day ranges, including overnight shifts, without inventing weekdays
  // merely from a numeric working-day count.
  const matches=[...raw.matchAll(/\b(Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs?(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/gi)];
  if(!matches.length)return [];
  const days=[];
  const indices=matches.map(m=>DAY_NAMES.indexOf(DNAME[m[0].toLowerCase()]));
  if(indices.length===2){
    const between=raw.slice(matches[0].index+matches[0][0].length,matches[1].index);
    if(/^\s*(?:-|–|—|to|through)\s*$/i.test(between)){
      let i=indices[0];for(let steps=0;steps<7;steps++){days.push(DAY_NAMES[i]);if(i===indices[1])return days;i=(i+1)%7;}
    }
  }
  for(const i of indices){if(i>=0&&!days.includes(DAY_NAMES[i]))days.push(DAY_NAMES[i]);}
  return days;
}
export function relayShiftCard(card={}){
  const c=card||{};
  const dates=Array.isArray(c.dates)?tokens(c.dates,31):[
    c.start_date?`Start: ${text(c.start_date,85)}`:null,
    c.end_date?`End: ${text(c.end_date,85)}`:null
  ].filter(Boolean);
  const d={dates,working_days:extractWorkingDays(c),
    start_time:text(c.start_time,100),end_time:text(c.end_time,100),
    weekly_hours:text(c.weekly_hours,100),pay:text(c.pay,150),
    location:text(c.location,200),
    original_shift_card_text:originalCardText(c.original_shift_card_text??c.original_text??c.text,3500),
    decision:DECISIONS.has(c.decision)?c.decision:'unknown'};
  optional(d,'shift_id',c.shift_id??c.key,100);
  const rank=numberOrNull(c.rank,1,10000);if(rank!==null)d.rank=rank;
  const reason=Array.isArray(c.rejection_reasons)?c.rejection_reasons.join('; '):c.rejection_reason;
  optional(d,'rejection_reason',reason,500);
  return d;
}
export function relayData(type,raw={}){
  if(!TYPES.has(type))throw new RelayPayloadError(type,'unsupported event type');
  const d=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  switch(type){
    case 'job_selected':return {
      job_id:required(type,'job_id',d.job_id,100),
      title:required(type,'title',d.title,200),
      location:required(type,'location',d.location,200)};
    case 'previously_attempted_job_changed':{
      const o={job_id:required(type,'job_id',d.job_id,100),
        newly_added_text:required(type,'newly_added_text',d.newly_added_text,3000)};
      optional(o,'title',d.title,200);return o;
    }
    case 'shift_card_detected':{
      const o={visit_id:required(type,'visit_id',d.visit_id,100),card:relayShiftCard(d.card)};
      optional(o,'job_id',d.job_id,100);return o;
    }
    case 'shift_selection_result':{
      const decision=d.decision;
      if(!RESULT_DECISIONS.has(decision))throw new RelayPayloadError(type,'invalid or missing decision');
      const o={visit_id:required(type,'visit_id',d.visit_id,100),decision};
      optional(o,'shift_id',d.shift_id??d.key,100);
      const rank=numberOrNull(d.rank,1,10000);if(rank!==null)o.rank=rank;
      optional(o,'reason',d.reason??(Array.isArray(d.rejection_reasons)?d.rejection_reasons.join('; '):null),500);
      return o;
    }
    case 'no_shift_cards':case 'no_suitable_shifts':{
      const o={visit_id:required(type,'visit_id',d.visit_id,100)};
      optional(o,'job_id',d.job_id,100);optional(o,'reason',d.reason,500);return o;
    }
    case 'automation_error':{
      const o={stage:required(type,'stage',d.stage,200),error:required(type,'error',d.error,1500),recovery_attempts:0};
      const attempts=numberOrNull(d.recovery_attempts,0,100);if(attempts!==null)o.recovery_attempts=attempts;
      return o;
    }
    case 'account_logged_out':case 'human_verification':{
      const o={stage:required(type,'stage',d.stage,200)};
      optional(o,'reason',d.reason,500);return o;
    }
    case 'prehire_appointment':{
      const o={job_id:required(type,'job_id',d.job_id,100),stage:'pre_hire_appointment'};
      optional(o,'title',d.title,200);return o;
    }
    case 'automation_status':{
      const state=String(d.state||'');
      if(!['running','stopped','paused','completed'].includes(state))throw new RelayPayloadError(type,'invalid state');
      return {stage:required(type,'stage',d.stage,200),state,detail:required(type,'detail',d.detail,500)};
    }
    case 'automation_stopped':return {
      stage:required(type,'stage',d.stage,200),reason:required(type,'reason',d.reason,500)};
    case 'shift_visit_completed':{
      const o={visit_id:required(type,'visit_id',d.visit_id,100),
        cards:(Array.isArray(d.cards)?d.cards:[]).slice(0,150).map(relayShiftCard)};
      optional(o,'job_id',d.job_id,100);optional(o,'title',d.title,200);
      optional(o,'selected_shift_id',d.selected_shift_id??d.selected_shift_key,100);
      optional(o,'summary',d.summary??d.reason,1000);
      return o;
    }
  }
}
export function buildRelayEvent(type,data,options={}){
  const id=options.event_id??crypto.randomUUID();
  if(typeof id!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(id))
    throw new RelayPayloadError(type,'invalid event_id');
  const occurred=options.occurred_at??new Date().toISOString();
  if(typeof occurred!=='string'||!Number.isFinite(Date.parse(occurred))||!/(?:Z|[+-]\d\d:\d\d)$/.test(occurred))
    throw new RelayPayloadError(type,'invalid occurred_at');
  return {event_id:id,event_type:type,occurred_at:occurred,data:relayData(type,data)};
}
