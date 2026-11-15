import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRelayEvent,relayData,relayShiftCard,extractWorkingDays,RELAY_EVENT_TYPES,RelayPayloadError} from '../src/relay_schema.js';
const raw={key:'shift-1',start_date:'16 Nov 2026',end_date:'16 Jan 2027',shift_days:'Mon–Fri 07:00–13:30',working_days:5,
  start_time:'07:00',end_time:'13:30',weekly_hours:30,pay:'£16.10/hr',location:'BS35 4BR',
  original_text:'Warehouse Associate Mon–Fri 07:00–13:30',rank:1,decision:'rejected',
  rejection_reasons:['Hours above maximum 15']};
const cases={
  job_selected:{job_id:'job-123',title:'Warehouse Associate',location:'Poole',card_text:'discard me'},
  previously_attempted_job_changed:{job_id:'job-123',title:'Warehouse Associate',newly_added_text:'Part Time',card_text:'discard'},
  shift_card_detected:{visit_id:'visit-123',job_id:'job-123',title:'discard',card:raw},
  shift_selection_result:{visit_id:'visit-123',key:'shift-1',rank:1,decision:'rejected',rejection_reasons:['Hours above 15'],cards:['discard']},
  no_shift_cards:{visit_id:'visit-123',job_id:'job-123',reason:'No shifts',checked:0},
  no_suitable_shifts:{visit_id:'visit-123',job_id:'job-123',reason:'No match',checked:1},
  automation_error:{stage:'shift_selection',error:'Unexpected stage',recovery_attempts:3,action:'discard',job_id:'discard'},
  account_logged_out:{stage:'search',reason:'Login detected',action_required:'manual',job_id:'discard'},
  human_verification:{stage:'security',reason:'Please verify',action_required:'manual'},
  prehire_appointment:{stage:'search',job_id:'job-123',title:'Warehouse',reason:'discard'},
  automation_stopped:{stage:'search',reason:'User stopped',stop_type:'discard',job_id:'discard'},
  automation_status:{stage:'search',state:'running',detail:'Scanning for jobs',extra:'discard'},
  shift_visit_completed:{visit_id:'visit-123',job_id:'job-123',title:'Warehouse',location:'discard',
    cards:[raw],selected_shift_key:null,card_count:1,reason:'No suitable shifts'}
};
const keys={
  job_selected:['job_id','title','location'],
  previously_attempted_job_changed:['job_id','title','newly_added_text'],
  shift_card_detected:['visit_id','job_id','card'],
  shift_selection_result:['visit_id','shift_id','rank','decision','reason'],
  no_shift_cards:['visit_id','job_id','reason'],no_suitable_shifts:['visit_id','job_id','reason'],
  automation_error:['stage','error','recovery_attempts'],
  account_logged_out:['stage','reason'],human_verification:['stage','reason'],
  prehire_appointment:['job_id','title','stage'],automation_stopped:['stage','reason'],
  automation_status:['stage','state','detail'],
  shift_visit_completed:['visit_id','job_id','title','cards','summary']
};
for(const [type,input] of Object.entries(cases)){
  test(`${type} sends only Oracle relay v2 supported fields`,()=>{
    const event=buildRelayEvent(type,input);
    assert.equal(event.event_type,type);
    assert.deepEqual(Object.keys(event.data).sort(),keys[type].sort());
    assert.equal(typeof event.event_id,'string');assert.ok(Date.parse(event.occurred_at)>0);
    assert.equal(JSON.stringify(event.data).includes('discard'),false);
  });
}
test('all 13 schemas covered (12 original plus status heartbeat)',()=>assert.deepEqual(RELAY_EVENT_TYPES.slice().sort(),Object.keys(cases).sort()));
test('shift cards follow strict source model, include original text, date range, weekday range, ranking and rejection',()=>{
  const d=relayShiftCard(raw);
  assert.deepEqual(d.working_days,['Mon','Tue','Wed','Thu','Fri']);
  assert.deepEqual(d.dates,['Start: 16 Nov 2026','End: 16 Jan 2027']);
  assert.equal(d.weekly_hours,'30');assert.equal(d.shift_id,'shift-1');
  assert.equal(d.original_shift_card_text,raw.original_text);
  assert.equal(d.rejection_reason,'Hours above maximum 15');
  assert.equal(d.rank,1);
  assert.deepEqual(Object.keys(d).sort(),['dates','working_days','start_time','end_time','weekly_hours','pay','location','original_shift_card_text','decision','shift_id','rank','rejection_reason'].sort());
});
test('do not invent working days from numeric count; do parse overnight and explicit weekday list',()=>{
  assert.deepEqual(extractWorkingDays({working_days:5}),[]);
  assert.deepEqual(extractWorkingDays({shift_days:'Mon–Wed 21:30–08:00'}),['Mon','Tue','Wed']);
  assert.deepEqual(extractWorkingDays({shift_days:'Sat–Mon 22:00–06:00'}),['Sat','Sun','Mon']);
});
test('test notification exact data, no accidental extras; empty required attributes rejected',()=>{
  assert.deepEqual(relayData('automation_stopped',{stage:'relay_test',reason:'TEST ONLY - Telegram connection check',test:true}),
    {stage:'relay_test',reason:'TEST ONLY - Telegram connection check'});
  assert.throws(()=>relayData('job_selected',{job_id:'x',title:'',location:''}),RelayPayloadError);
  assert.throws(()=>relayData('shift_selection_result',{visit_id:'x',cards:[]}),RelayPayloadError);
  assert.throws(()=>buildRelayEvent('invented_type',{}),RelayPayloadError);
});

test('new automation_status requires exact state, stage, and nonempty detail',()=>{
  assert.deepEqual(relayData('automation_status',{stage:'shift',state:'running',detail:'Selecting',password:'unsafe'}),
    {stage:'shift',state:'running',detail:'Selecting'});
  assert.throws(()=>relayData('automation_status',{stage:'search',state:'stucked',detail:'No'}),RelayPayloadError);
  assert.throws(()=>relayData('automation_status',{stage:'search',state:'running',detail:''}),RelayPayloadError);
});
