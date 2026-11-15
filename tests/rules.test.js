import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,clone,normaliseSettings,rankJobs,rankShifts,validateShiftSettings,scheduleAt,nextClockRefresh,ukParts,isFast} from '../src/rules.js';
const settings=()=>clone(DEFAULTS);
const jobs=[
 {id:'sw',locationText:'Swindon, England',text:'Swindon, England Reduced',distanceMiles:5,order:0},
 {id:'pb',locationText:'Peterborough, England',text:'Peterborough, England Reduced',distanceMiles:20,order:1},
 {id:'ml',locationText:'Multiple On Site locations available',text:'Multiple On Site locations available Type: Full Time, Part Time, Reduced',distanceMiles:1,order:2},
 {id:'near',locationText:'Tilbury, England',text:'Tilbury, England Full Time',distanceMiles:9.9,order:3},
 {id:'edge',locationText:'Hull, England',text:'Hull, England Part Time',distanceMiles:10,order:4},
 {id:'nodist',locationText:'Bowthorpe, England',text:'Bowthorpe, England Reduced',distanceMiles:null,order:5}
];
test('Box 1 Priority falls back rather than excluding other cards',()=>{
 const s=settings();s.box1.keywords=['Peterborough','Swindon'];
 assert.deepEqual(rankJobs(jobs,s).slice(0,2).map(x=>x.id),['pb','sw']);
 assert.equal(rankJobs(jobs,s).length,6);
});
test('Box 1 Required never falls back and accepts partial case-insensitive matches',()=>{
 const s=settings();s.box1.mode='required';s.box1.keywords=['bow'];
 assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['nodist']);
});
test('Box 2 OFF has no effect on filter or distance scope',()=>{
 const s=settings();s.box2.keywords=['Unfindable'];s.box2.mode='required';
 assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['ml','sw','near']);
});
test('Both Required means AND across boxes; OR within each box',()=>{
 const s=settings();s.box1={scope:'location',mode:'required',keywords:['Swindon','Tilbury']};
 s.box2={scope:'all',mode:'required',enabled:true,keywords:['Full Time']};
 assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['near']);
});
test('Required in box 2 filters before Priority in box 1',()=>{
 const s=settings();s.box1.keywords=['Swindon'];s.box2={scope:'all',mode:'required',enabled:true,keywords:['Full Time']};
 assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['ml','near']);
});
test('Empty keywords applies strict maximum miles, excludes missing distance',()=>{
 const s=settings();assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['ml','sw','near']);
 s.maxMiles=null;assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['ml','sw','near','edge','pb','nodist']);
});
test('Any entered keyword ignores distance cap, even priority fallback',()=>{
 const s=settings();s.box1.keywords=['Unmatched'];assert.equal(rankJobs(jobs,s).length,jobs.length);
});
test('Disabled Box 2 keywords do not suppress maximum miles',()=>{
 const s=settings();s.box2.keywords=['Full Time'];s.box2.enabled=false;
 assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['ml','sw','near']);
});
test('Two Priority boxes rank first box before second',()=>{
 const s=settings();s.box1.keywords=['England'];s.box2={enabled:true,mode:'priority',scope:'all',keywords:['Full Time','Reduced']};
 assert.deepEqual(rankJobs(jobs,s).slice(0,3).map(x=>x.id),['near','sw','pb']);
});
test('Plymouth screenshot: Required keyword matches the whole visible card despite old location-only scope',()=>{
 const s=settings();s.box1.mode='required';s.box1.keywords=['Plymouth'];s.box1.scope='location';
 const cards=[
  {id:'plymouth',text:'Delivery Station Warehouse Associate Type: Reduced Duration: Fixed-term Pay rate: From £15.10 Within 0.1 mi | Plymouth, England',locationText:'',distanceMiles:0.1,order:0},
  {id:'bristol',text:'Warehouse Associate Type: Reduced Within 0.2 mi | Bristol, England',locationText:'Bristol, England',distanceMiles:0.2,order:1}
 ];
 assert.deepEqual(rankJobs(cards,s).map(x=>x.id),['plymouth']);
});
test('Two Required boxes must both match inside a single job card, not across separate cards',()=>{
 const s=settings();s.box1.mode='required';s.box1.keywords=['Plymouth'];
 s.box2={enabled:true,mode:'required',keywords:['Full Time']};
 const cards=[
   {id:'a',text:'Plymouth, England Type: Reduced',order:0},
   {id:'b',text:'Exeter, England Type: Full Time',order:1},
   {id:'c',text:'Plymouth, England Type: Full Time',order:2}
 ];
 assert.deepEqual(rankJobs(cards,s).map(x=>x.id),['c']);
});
test('Migrate pre-v1.1 settings: retain keywords and schedules, remove click pattern and match scopes',()=>{
 const prev={pattern:'legacy',box1:{mode:'required',scope:'location',keywords:['Plymouth']},
   box2:{mode:'priority',scope:'employmentType',enabled:true,keywords:['Reduced']},
   slowMinutes:7,shifts:{minHours:20,maxHours:40,days:4}};
 const s=normaliseSettings(prev);
 assert.equal('pattern' in s,false);
 assert.equal('scope' in s.box1,false);assert.equal('scope' in s.box2,false);
 assert.deepEqual(s.box1,{mode:'required',keywords:['Plymouth']});
 assert.deepEqual(s.box2,{enabled:true,mode:'priority',keywords:['Reduced']});
 assert.equal(s.slowMinutes,7);assert.equal(s.shifts.minHours,20);assert.equal(s.shifts.days,4);
});
const shifts=[
 {id:'four',weeklyHours:40,workingDays:4,startTime:'07:00',order:0},
 {id:'five',weeklyHours:40,workingDays:5,startTime:'19:00',order:1},
 {id:'twenty',weeklyHours:24,workingDays:4,startTime:'06:00',order:2},
 {id:'missing',weeklyHours:null,workingDays:5,startTime:'06:00',order:3},
 {id:'nodays',weeklyHours:40,workingDays:null,startTime:null,order:4}
];
test('Mandatory weekly hours range is inclusive',()=>{
 const s=settings().shifts;s.minHours=40;s.maxHours=40;
 assert.deepEqual(rankShifts(shifts,s).map(x=>x.id),['five','four','nodays']);
});
test('Working-day Required excludes different and missing counts',()=>{
 const s=settings().shifts;s.minHours=20;s.maxHours=40;s.days=5;s.daysMode='required';
 assert.deepEqual(rankShifts(shifts,s).map(x=>x.id),['five']);
});
test('Working-day Priority selects exact matches ahead of others, unreadable last',()=>{
 const s=settings().shifts;s.minHours=20;s.maxHours=40;s.days=5;
 assert.deepEqual(rankShifts(shifts,s).map(x=>x.id),['five','four','twenty','nodays']);
});
test('Hours-first ranking, then start-time tie breaker',()=>{
 const s=settings().shifts;s.minHours=20;s.maxHours=40;s.days=4;s.rankingEnabled=true;s.rankingMethod='hours';s.startSlots=['06:00','18:00','12:00','00:00'];
 assert.deepEqual(rankShifts(shifts,s).slice(0,2).map(x=>x.id),['four','twenty']);
});
test('Time-first ranking, then higher hours',()=>{
 const s=settings().shifts;s.minHours=20;s.maxHours=40;s.days=4;s.rankingEnabled=true;s.rankingMethod='time';s.startSlots=['06:00','18:00','12:00','00:00'];
 assert.deepEqual(rankShifts(shifts,s).slice(0,2).map(x=>x.id),['four','twenty']);
});
test('Reject missing mandatory weekly hours / invalid settings',()=>{
 const s=settings().shifts;s.minHours=40;s.maxHours=30;
 assert.ok(validateShiftSettings(s));assert.deepEqual(rankShifts(shifts,s),[]);
});
const stamp=s=>new Date(s).getTime();
test('UK FAST window starts two minutes before at second 02',()=>{
 const s=settings();assert.equal(scheduleAt(stamp('2026-10-25T02:58:02Z'),s),'FAST');
 assert.equal(scheduleAt(stamp('2026-10-25T03:30:05Z'),s),'SLOW');
});
test('UK slow clock aligned to minute multiple not timer start',()=>{
 const s=settings();assert.equal(scheduleAt(stamp('2026-10-25T04:04:05Z'),s),'SLOW');
 assert.equal(scheduleAt(stamp('2026-10-25T04:05:05Z'),s),null);
});
test('Next refresh chooses earliest configured second regardless of insertion order',()=>{
 const s=settings();s.fastSeconds=[45,2,35,8,25,15];
 const at=nextClockRefresh(stamp('2026-10-25T02:58:01Z'),s);
 assert.equal(new Date(at.when).toISOString(),'2026-10-25T02:58:02.000Z');
});
test('GMT/BST UK clock conversion used',()=>{
 assert.deepEqual(ukParts(stamp('2026-06-01T14:00:00Z')),{hour:15,minute:0,second:0});
 assert.deepEqual(ukParts(stamp('2026-12-01T14:00:00Z')),{hour:14,minute:0,second:0});
});
test('If FAST seconds empty, only SLOW applies',()=>{
 const s=settings();s.fastSeconds=[];
 assert.equal(isFast(ukParts(stamp('2026-10-25T03:01:00Z')),s),false);
 assert.equal(scheduleAt(stamp('2026-10-25T03:02:05Z'),s),'SLOW');
});


test('Poole is a qualifying Priority keyword regardless of job type',()=>{
  const s=clone(DEFAULTS);
  s.box1={mode:'priority',keywords:['Poole']};
  s.box2={enabled:false,mode:'required',keywords:[]};
  const jobs=[{id:'poole',text:'Delivery Station Warehouse Associate Type: Flexible Shifts, Full Time, Part Time, Reduced Duration: Fixed-term Pay rate: From £15.10 Within 0.1 mi | Poole, England',distanceMiles:0.1,order:0},
    {id:'elsewhere',text:'Delivery Station Warehouse Associate Within 0.2 mi | Bristol, England',distanceMiles:0.2,order:1}];
  assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['poole','elsewhere']);
  s.box1.mode='required';
  assert.deepEqual(rankJobs(jobs,s).map(x=>x.id),['poole']);
});
