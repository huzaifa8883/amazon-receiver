/* Reusable, pure selection + clock logic. No DOM/Chrome dependencies. */
export const DEFAULTS = Object.freeze({
  searchUrl:'https://www.jobsatamazon.co.uk/app#/jobSearch',
  refreshMode:'builtin',
  checkpoints:['00:00','03:00','06:00','09:00','12:00','15:00','18:00','21:00'],
  fastBefore:2, fastAfter:30, fastSeconds:[2,8,15,25,35,45],
  slowMinutes:2, slowSecond:5,
  box1:{keywords:[],mode:'priority'},
  box2:{enabled:false,keywords:[],mode:'required'},
  maxMiles:10,
  shifts:{minHours:null,maxHours:null,days:5,daysMode:'priority',rankingEnabled:false,
    rankingMethod:'hours',startSlots:['00:00','06:00','12:00','18:00']}
});
// Preserve user preferences from older releases while removing legacy pattern/scope.
// Both keyword boxes now match the visible text of the SAME card, without exceptions.
export function normaliseSettings(saved={}){
  const s=clone(DEFAULTS);
  if(!saved||typeof saved!=='object')return s;
  for(const key of ['searchUrl','checkpoints','fastBefore','fastAfter','fastSeconds','slowMinutes','slowSecond','maxMiles']){
    if(Object.hasOwn(saved,key))s[key]=saved[key];
  }
  for(const box of ['box1','box2']){
    if(saved[box]&&typeof saved[box]==='object'){
      const b=saved[box];
      if(Array.isArray(b.keywords))s[box].keywords=cleanKeywords(b.keywords);
      if(b.mode==='required'||b.mode==='priority')s[box].mode=b.mode;
      if(box==='box2')s.box2.enabled=b.enabled===true;
    }
  }
  if(saved.refreshMode==='oracle')s.refreshMode='oracle';
  if(saved.shifts&&typeof saved.shifts==='object')s.shifts={...s.shifts,...saved.shifts};
  return s;
}
export const clone = x => JSON.parse(JSON.stringify(x));
export function cleanKeywords(items){return (items||[]).map(x=>String(x||'').trim().replace(/\s+/g,' ')).filter(Boolean);}
const norm = s => String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
const matchRank = (text,keywords) => {
  const hay=norm(text); return keywords.findIndex(k=>hay.includes(norm(k)));
};
const numDistance = c => Number.isFinite(Number(c.distanceMiles)) && c.distanceMiles !== null && c.distanceMiles !== '' ? Number(c.distanceMiles):Infinity;
function idxCompare(a,b){return (a===-1?Infinity:a)-(b===-1?Infinity:b);}
export function rankJobs(cards, settings) {
  const b1=settings.box1||DEFAULTS.box1,b2=settings.box2||DEFAULTS.box2;
  const active=[b1,...(b2.enabled?[b2]:[])].map((b,i)=>({
    index:i,mode:b.mode==='required'?'required':'priority',words:cleanKeywords(b.keywords)
  }));
  const hasAnyWords=active.some(b=>b.words.length);
  const limit=settings.maxMiles===null||settings.maxMiles===''?null:Number(settings.maxMiles);
  const eligible=[];
  cards.forEach((card,index)=>{
    const ranks=active.map(b=>b.words.length?matchRank(card.text,b.words):-1);
    if(active.some((b,i)=>b.mode==='required'&&b.words.length&&ranks[i]===-1))return;
    if(!hasAnyWords && limit!==null && (!Number.isFinite(numDistance(card))||numDistance(card)>=limit))return;
    eligible.push({...card,_originalIndex:index,_matchRanks:ranks});
  });
  eligible.sort((a,b)=>{
    for(const mode of ['priority','required'])for(let i=0;i<active.length;i++){
      if(active[i].mode!==mode||!active[i].words.length)continue;
      const c=idxCompare(a._matchRanks[i],b._matchRanks[i]);if(c)return c;
    }
    const d=numDistance(a)-numDistance(b);
    if(Number.isFinite(d)&&d!==0)return d;
    if(!Number.isFinite(numDistance(a))&&Number.isFinite(numDistance(b)))return 1;
    if(Number.isFinite(numDistance(a))&&!Number.isFinite(numDistance(b)))return -1;
    return (a.order??a._originalIndex)-(b.order??b._originalIndex);
  });
  return eligible;
}
const timeSlots=['00:00','06:00','12:00','18:00'];
function slotFor(hhmm){
  if(!/^\d\d:\d\d$/.test(String(hhmm)))return null;
  const [h,m]=hhmm.split(':').map(Number);if(h>23||m>59)return null;
  return timeSlots[Math.floor(h/6)];
}
export function validateShiftSettings(s) {
  const min=Number(s?.minHours),max=Number(s?.maxHours),days=Number(s?.days);
  if(s?.minHours===null||s?.minHours===''||s?.maxHours===null||s?.maxHours==='')return 'Enter both minimum and maximum weekly hours.';
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>168||min>max)return 'Weekly hours must be valid numbers (0–168), with minimum no greater than maximum.';
  if(!Number.isInteger(days)||days<1||days>7)return 'Working days must be a whole number between 1 and 7.';
  return null;
}
export function rankShifts(cards, s){
  if(validateShiftSettings(s))return [];
  const min=Number(s.minHours),max=Number(s.maxHours),days=Number(s.days);
  const slots=Array.isArray(s.startSlots)?s.startSlots.filter((slot,i,arr)=>timeSlots.includes(slot)&&arr.indexOf(slot)===i):[];
  const eligible=cards.filter(c=>Number.isFinite(c.weeklyHours)&&c.weeklyHours>=min&&c.weeklyHours<=max)
    .filter(c=>s.daysMode!=='required'||c.workingDays===days);
  const dayScore = c => c.workingDays===days?0:Number.isInteger(c.workingDays)?1:2;
  const slotScore = c => {const slot=slotFor(c.startTime);const n=slots.indexOf(slot);return n===-1?Infinity:n;};
  eligible.sort((a,b)=>{
    if(s.daysMode!=='required'){const d=dayScore(a)-dayScore(b);if(d)return d;}
    if(s.rankingEnabled){
      const hours=b.weeklyHours-a.weeklyHours, time=slotScore(a)-slotScore(b);
      if(s.rankingMethod==='time'){if(time)return time;if(hours)return hours;}
      else {if(hours)return hours;if(time)return time;}
    }
    return (a.order||0)-(b.order||0);
  });
  return eligible;
}
const ukFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function ukParts(t){
  const parts=Object.fromEntries(ukFormat.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return {hour:parts.hour, minute:parts.minute, second:parts.second};
}
function secDay(p){return p.hour*3600+p.minute*60+p.second;}
export function isFast(p,s){
  if(!(s.fastSeconds||[]).length)return false;
  const now=secDay(p),before=Math.max(0,Number(s.fastBefore)||0)*60,after=Math.max(0,Number(s.fastAfter)||0)*60;
  return (s.checkpoints||[]).some(cp=>{
    if(!/^\d\d:\d\d$/.test(cp))return false;
    const [h,m]=cp.split(':').map(Number);if(h>23||m>59)return false;
    const point=h*3600+m*60;
    const delta=((now-point+43200+86400)%86400)-43200;
    return delta>=-before && delta<after;
  });
}
export function scheduleAt(t,s){
  const p=ukParts(t),fast=isFast(p,s);
  if(fast)return (s.fastSeconds||[]).includes(p.second)?'FAST':null;
  const every=Math.max(1,Number(s.slowMinutes)||2);
  return (p.hour*60+p.minute)%every===0&&p.second===Number(s.slowSecond)?'SLOW':null;
}
export function nextClockRefresh(now,s){
  // Search by UK clock minute rather than elapsed time. Works across GMT/BST transitions.
  const secs=[...new Set([...(s.fastSeconds||[]),Number(s.slowSecond)])].filter(x=>Number.isInteger(x)&&x>=0&&x<60).sort((a,b)=>a-b);
  const first=Math.floor(now/60000)*60000;
  for(let k=0;k<400;k++){
    const minute=first+k*60000;
    for(const sec of secs){
      const t=minute+sec*1000;
      if(t>now+50 && scheduleAt(t,s))return {when:t,mode:scheduleAt(t,s)};
    }
  }
  return null;
}
