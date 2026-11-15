/* Pure job-card change detection and shift audit logic. */
export function addedCardText(previous,current){
  const normal=x=>String(x||'').toLocaleLowerCase('en-GB').replace(/[’]/g,"'")
    .replace(/\bwithin\s+\d+(?:\.\d+)?\s*(?:mi|miles?)\b/g,'within distance')
    .replace(/£\s*\d+(?:\.\d+)?/g,'pay amount')
    .replace(/[^a-z0-9]+/g,' ').trim();
  const a=normal(previous).split(/\s+/).filter(Boolean),b=normal(current).split(/\s+/).filter(Boolean);
  const count=new Map();for(const word of a)count.set(word,(count.get(word)||0)+1);
  const added=[];for(const word of b){if(count.get(word)>0)count.set(word,count.get(word)-1);else if(/[a-z]/.test(word)&&word.length>1)added.push(word);}
  return added.join(' ').slice(0,450);
}
function field(text,pattern){return text.match(pattern)?.[1]?.trim()||null;}
export function makeShiftRecord(c,visitId,job){
  const t=String(c.text||'').slice(0,6000);
  const shift=field(t,/\bShift\s*:\s*(.*?)(?=\b(?:Hours|Pay|Start date|End date|Location)\s*:|$)/i)||'';
  const clock=shift.match(/\b(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*(?:-|–|—|to)\s*(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)/i);
  const hours=c.weeklyHours??Number(field(t,/\bHours\s*:\s*(\d+(?:\.\d+)?)/i));
  return {key:c.key,visit_id:visitId,job_id:job.job_id||'',job_title:job.title||'',job_location:job.location||'',
    start_date:field(t,/\bStart date\s*:\s*(.*?)(?=\b(?:End date|Hours|Shift|Pay|Location)\s*:|$)/i),
    end_date:field(t,/\bEnd date\s*:\s*(.*?)(?=\b(?:Start date|Hours|Shift|Pay|Location)\s*:|$)/i),
    shift_days:shift,working_days:c.workingDays??null,start_time:c.startTime||clock?.[1]||null,
    end_time:c.endTime||clock?.[2]||null,weekly_hours:Number.isFinite(hours)?hours:null,
    pay:field(t,/\bPay(?: rate)?\s*:\s*(.*?)(?=\b(?:Start date|End date|Hours|Shift|Location)\s*:|$)/i),
    location:field(t,/\bLocation\s*:\s*(.*?)(?=\b(?:Start date|End date|Hours|Shift|Pay)\s*:|$)/i),
    original_text:t,captured_at:new Date().toISOString(),rank:null,decision:null,rejection_reasons:[]};
}
export function shiftDecision(c,config){
  const reasons=[],hours=Number(c.weekly_hours??c.weeklyHours),days=Number(c.working_days??c.workingDays);
  if(c.weekly_hours==null&&c.weeklyHours==null||!Number.isFinite(hours)||hours<Number(config.minHours)||hours>Number(config.maxHours))reasons.push(`Weekly hours outside ${config.minHours}–${config.maxHours}`);
  if(config.daysMode==='required'&&days!==Number(config.days))reasons.push(`Working days not ${config.days}`);
  return {eligible:reasons.length===0,reasons};
}

/** One consolidated, audited relay event per completed shift-selection visit.
 * This is deliberately compatible with the existing Oracle relay v2 schema;
 * the relay generates the full CSV from `cards` without any extension file.
 * Do not include applicant details or emit a second per-card notification.
 */
export function shiftVisitReport(visit,reason,selectedKey=null){
  if(!visit?.visit_id||!Array.isArray(visit.cards))throw new TypeError('Invalid shift visit');
  const outcome=selectedKey?'Selected qualifying shift':!visit.cards.length?'No shift cards available':'No qualifying shift';
  const summary=[outcome,String(reason||'').trim()].filter(Boolean).join(' — ').slice(0,1000);
  return {type:'shift_visit_completed',data:{
    visit_id:visit.visit_id,
    job_id:visit.job?.job_id||'',
    title:visit.job?.title||'',
    cards:visit.cards,
    summary,
    selected_shift_id:selectedKey||undefined
  }};
}
