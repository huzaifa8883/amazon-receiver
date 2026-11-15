import {DEFAULTS,clone,normaliseSettings,validateShiftSettings} from './src/rules.js';
const $=id=>document.getElementById(id);let settings=null;
// Appearance preferences are stored separately from automation settings; changing
// the theme must never reset job, shift, Telegram or refresh configuration.
const THEME_KEY='appearanceTheme';
const THEME_VALUES=new Set(['soft-blue','minimal-white','warm-cream','soft-dark']);
function applyTheme(value){
  const theme=THEME_VALUES.has(value)?value:'soft-blue';
  document.documentElement.dataset.theme=theme;
  $('themeSelect').value=theme;
  return theme;
}

const text=(id,v)=>{$(id).value=v??'';};
const value=id=>$(id).value.trim();
const lineList=id=>$(id).value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
function slotsSetup(){
  const choices=[['','— unused —'],['00:00','00:00–05:59'],['06:00','06:00–11:59'],['12:00','12:00–17:59'],['18:00','18:00–23:59']];
  for(let i=0;i<4;i++)$( 'slot'+i).replaceChildren(...choices.map(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;}));
}
function populate(s){
  settings=s;text('refreshMode',s.refreshMode||'builtin');text('box1mode',s.box1.mode);text('box1keywords',s.box1.keywords.join('\n'));
  $('box2enabled').checked=s.box2.enabled;text('box2mode',s.box2.mode);text('box2keywords',s.box2.keywords.join('\n'));
  text('maxMiles',s.maxMiles);text('minHours',s.shifts.minHours);text('maxHours',s.shifts.maxHours);text('days',s.shifts.days);
  text('daysMode',s.shifts.daysMode);$('rankEnabled').checked=s.shifts.rankingEnabled;text('rankingMethod',s.shifts.rankingMethod);
  for(let i=0;i<4;i++)text('slot'+i,s.shifts.startSlots?.[i]);
  text('checkpoints',s.checkpoints.join(', '));text('fastBefore',s.fastBefore);text('fastAfter',s.fastAfter);
  text('fastSeconds',s.fastSeconds.map(x=>String(x).padStart(2,'0')).join(', '));
  text('slowMinutes',s.slowMinutes);text('slowSecond',s.slowSecond);text('searchUrl',s.searchUrl);
  $('box2controls').style.opacity=s.box2.enabled?1:.45;
}
function collect(){
  const num=(id,empty=null)=>value(id)===''?empty:Number(value(id));
  const cfg=clone(settings||DEFAULTS);cfg.refreshMode=value('refreshMode');
  cfg.box1={mode:value('box1mode'),keywords:lineList('box1keywords')};
  cfg.box2={enabled:$('box2enabled').checked,mode:value('box2mode'),keywords:lineList('box2keywords')};
  cfg.maxMiles=num('maxMiles');cfg.shifts={minHours:num('minHours'),maxHours:num('maxHours'),days:num('days'),daysMode:value('daysMode'),
    rankingEnabled:$('rankEnabled').checked,rankingMethod:value('rankingMethod'),startSlots:[0,1,2,3].map(i=>value('slot'+i))};
  cfg.checkpoints=value('checkpoints').split(',').map(x=>x.trim()).filter(Boolean);
  cfg.fastBefore=num('fastBefore');cfg.fastAfter=num('fastAfter');
  cfg.fastSeconds=value('fastSeconds')?value('fastSeconds').split(',').map(x=>x.trim()).filter(Boolean).map(Number):[];
  cfg.slowMinutes=num('slowMinutes');cfg.slowSecond=num('slowSecond');cfg.searchUrl=value('searchUrl');return cfg;
}
function validate(s){
  if(s.maxMiles!==null&&(!Number.isFinite(s.maxMiles)||s.maxMiles<0))return 'Maximum miles must be zero or greater, or left blank.';
  {const e=validateShiftSettings(s.shifts);if(e)return e;}
  const slots=s.shifts.startSlots.filter(Boolean);if(new Set(slots).size!==slots.length)return 'Do not repeat a start-time priority slot.';
  if(!s.checkpoints.length||s.checkpoints.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))return 'Enter UK checkpoint times as HH:MM.';
  if(!Number.isInteger(s.fastBefore)||s.fastBefore<0||s.fastBefore>180||!Number.isInteger(s.fastAfter)||s.fastAfter<0||s.fastAfter>180)return 'FAST windows must be 0–180 minutes.';
  if(s.fastSeconds.some(x=>!Number.isInteger(x)||x<0||x>59)||new Set(s.fastSeconds).size!==s.fastSeconds.length)return 'FAST seconds must be unique whole numbers between 0 and 59.';
  if(!Number.isInteger(s.slowMinutes)||s.slowMinutes<1||s.slowMinutes>1440||!Number.isInteger(s.slowSecond)||s.slowSecond<0||s.slowSecond>59)return 'Check SLOW interval and second.';
  if(!Number.isInteger(s.shifts.days)||s.shifts.days<1||s.shifts.days>7)return 'Working days must be between 1 and 7.';
  try{const u=new URL(s.searchUrl);if(u.protocol!=='https:'||!/(^|\.)jobsatamazon\.co\.uk$/i.test(u.hostname))throw Error();}catch{return 'Search URL must be a valid jobsatamazon.co.uk HTTPS address.';}
  return null;
}
async function save(){const cfg=collect(),error=validate(cfg);$('saveFeedback').textContent=error||'';if(error)return false;
  if(cfg.refreshMode==='oracle'){
    const configured=await chrome.runtime.sendMessage({type:'COMMAND',command:'ORACLE_SIGNAL_STATUS'}).catch(()=>null);
    if(!configured?.receiver?.configured){$('saveFeedback').textContent='Save a valid Oracle WSS endpoint, Receiver ID and device-specific credential before selecting Oracle Signal Only.';return false;}
  }
  const previous=await chrome.storage.local.get('settings');
  await chrome.storage.local.set({settings:cfg});
  const result=await chrome.runtime.sendMessage({type:'COMMAND',command:'SETTINGS_SAVED'});
  if(!result?.ok){await chrome.storage.local.set({settings:previous.settings||clone(DEFAULTS)});$('saveFeedback').textContent=result?.error||'Could not activate refresh mode.';return false;}
  settings=cfg;
  $('saveFeedback').textContent='Saved. Refresh mode switches immediately; other preferences apply to the next search cycle.';return true;
}
async function command(name){$('feedback').textContent='';for(const b of ['start','stop','manual','reset'])$(b).disabled=true;
  try{
    if(!['STOP','RESET'].includes(name)&&!(await save()))return;
    const res=await chrome.runtime.sendMessage({type:'COMMAND',command:name});
    $('feedback').textContent=res?.ok?(name==='RESET'?'Session reset. Saved settings kept. Open Recommended and press Start.':''):(res?.error||'Could not complete command.');
    await updateState();
  }catch(e){$('feedback').textContent=String(e);}finally{for(const b of ['start','stop','manual','reset'])$(b).disabled=false;}
}
async function updateState(){
  const s=(await chrome.storage.session.get('session')).session;
  $('status').textContent=s?.status||'Stopped';
  document.querySelector('.status-line')?.classList.toggle('is-running',!!s?.running);
  document.querySelector('.status-line')?.classList.toggle('is-paused',!!s?.pauseReason);
  const d=s?.searchDiagnostics;
  $('cardDiagnostics').textContent=d?`Last scan: ${d.visible} cards · ${d.eligible} eligible · Recommended: ${d.view}${Number.isFinite(d.cardScanMs)?` · ${d.cardScanMs} ms`:''}`:'No job-card scan recorded yet.';
  if(s?.pauseReason==='security'){$('nextRefresh').textContent='Manual security check required. Finish it yourself, then press Start. No automatic clicks or refreshes.';}
  else if(s?.pauseReason==='login'){$('nextRefresh').textContent='Amazon login required. Sign in manually and press Start. No automatic clicks or refreshes.';}
  else if(s?.running&&s?.config?.refreshMode==='oracle'&&!s?.signalCycleActive&&!s.appTabId){$('nextRefresh').textContent='Waiting for a validated Oracle signal. No scheduled search refresh.';}
  else if(s?.nextRefresh?.when&&s.running){
    const d=new Date(s.nextRefresh.when).toLocaleString('en-GB',{timeZone:'Europe/London',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    $('nextRefresh').textContent=`Next ${s.nextRefresh.mode} refresh · ${d} UK time`;
  }else if(s?.running&&s.appTabId){$('nextRefresh').textContent='Search refreshes paused while applying.';}
  else $('nextRefresh').textContent=s?.phase==='idle'?'Session reset. Open Recommended and press Start.':'Stopped, or waiting for the application stage.';
}
// Fast, accessible lightweight settings tabs: inputs stay mounted so Save
// settings still validates and persists the complete configuration.
const tabs=[...document.querySelectorAll('.tab')];
function selectTab(name){
  for(const tab of tabs){const selected=tab.dataset.target===name;
    tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));}
  for(const panel of document.querySelectorAll('section[data-panel]')){
    const selected=panel.dataset.panel===name;
    panel.classList.toggle('active',selected);panel.hidden=!selected;
  }
  window.scrollTo({top:0,behavior:'instant'});
}
tabs.forEach(tab=>tab.addEventListener('click',()=>selectTab(tab.dataset.target)));
selectTab('overview');
const storedTheme=(await chrome.storage.local.get(THEME_KEY))[THEME_KEY];
applyTheme(storedTheme);
$('themeSelect').addEventListener('change',async()=>{
  const theme=applyTheme($('themeSelect').value);
  try{await chrome.storage.local.set({[THEME_KEY]:theme});
    $('themeFeedback').textContent='Theme saved. It will be used next time you open the extension.';
  }catch(e){$('themeFeedback').textContent='Could not save the appearance preference.';}
});
slotsSetup();const saved=(await chrome.storage.local.get('settings')).settings;populate(normaliseSettings(saved));
$('box2enabled').addEventListener('change',()=>$('box2controls').style.opacity=$('box2enabled').checked?1:.45);
$('save').addEventListener('click',save);$('start').addEventListener('click',()=>command('START'));
$('stop').addEventListener('click',()=>command('STOP'));$('manual').addEventListener('click',()=>command('MANUAL_REFRESH'));
$('reset').addEventListener('click',()=>command('RESET'));
async function updateRelay(){
  const response=await chrome.runtime.sendMessage({type:'COMMAND',command:'RELAY_STATUS'});
  const r=response?.relay||{};
  $('relayEnabled').checked=!!r.enabled;
  $('relayHeartbeat').checked=!!r.statusEnabled;
  $('relayStatus').textContent=`${r.configured?'API key configured':'No API key'} · ${r.pending||0} queued · ${r.lastResult||'Not tested'}`;
}
$('relaySave').addEventListener('click',async()=>{
  const key=$('relayKey').value.trim();
  const relay={enabled:$('relayEnabled').checked};if(key)relay.apiKey=key;
  const response=await chrome.runtime.sendMessage({type:'COMMAND',command:'RELAY_CONFIGURE',relay});
  $('relayKey').value='';
  $('relayStatus').textContent=response?.ok?'Relay preferences saved.':response?.error||'Cannot save relay settings';
  await updateRelay();
});
$('relayForget').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({type:'COMMAND',command:'RELAY_CONFIGURE',relay:{enabled:false,apiKey:''}});
  $('relayKey').value='';await updateRelay();
});
$('relayTest').addEventListener('click',async()=>{
  const b=$('relayTest');b.disabled=true;$('relayTestResult').textContent='Sending unique TEST ONLY event…';
  try{
    const response=await chrome.runtime.sendMessage({type:'COMMAND',command:'RELAY_TEST'});
    if(!response?.ok)$('relayTestResult').textContent=response?.error||'Test failed.';
    else if(response.receipt==='queued')$('relayTestResult').textContent='Test queued (HTTP 202). A new Telegram message should follow.';
    else if(response.receipt==='duplicate')$('relayTestResult').textContent='Duplicate (HTTP 202). Relay did not queue another message.';
    else $('relayTestResult').textContent='HTTP 202 received, but relay did not return a queue status. Check Telegram.';
    await updateRelay();
  }catch{$('relayTestResult').textContent='Cannot contact the extension background worker.';}
  finally{b.disabled=false;}
});
$('relayHeartbeat').addEventListener('change',async()=>{
  const b=$('relayHeartbeat');b.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({type:'COMMAND',command:'RELAY_STATUS_INTERVAL',enabled:b.checked});
    $('heartbeatFeedback').textContent=response?.ok?
      (b.checked?'20-minute reports enabled; first report is due in about 20 minutes.':'20-minute reports switched off.'):
      (response?.error||'Unable to update the status schedule.');
    await updateRelay();
  }catch{$('heartbeatFeedback').textContent='Unable to reach extension background worker.';}
  finally{b.disabled=false;}
});
chrome.storage.onChanged.addListener((_c,area)=>{if(area==='session'){updateState().catch(()=>{});updateReceiver().catch(()=>{});}if(area==='local'){updateRelay().catch(()=>{});updateReceiver().catch(()=>{});}});
// Incoming Oracle receiver settings are isolated from the outbound Telegram relay.
function receiverAppearance(){
  const on=$('refreshMode').value==='oracle';
  $('oracleReceiverPanel').classList.toggle('receiver-on',on);
  $('builtInRefreshSettings').style.opacity=on?'.5':'1';
  $('manual').disabled=on;
}
$('refreshMode').addEventListener('change',receiverAppearance);
async function updateReceiver(){
  try{
    const res=await chrome.runtime.sendMessage({type:'COMMAND',command:'ORACLE_SIGNAL_STATUS'});
    const x=res?.receiver||{};
    const c=x.connection||{};
    const stage=x.receiverState||'DISABLED';
    const last=x.lastSignal?.receivedAt?new Date(x.lastSignal.receivedAt).toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'none';
    $('oracleReceiverStatus').textContent=`Receiver: ${x.receiverId||'not set'} · ${x.configured?'configured':'not configured'} · Connection: ${c.state||'stopped'} · ${stage} · ${x.currentStage||'idle'}${x.currentJob?' · '+x.currentJob:''} · ${x.pending||0} pending · Last signal: ${last}${c.error?' · '+c.error:''}`;
    const ack=x.acknowledgement;
    const ackText=ack?.signalId?`${ack.signalId} ${ack.accepted?'confirmed by Oracle':'rejected by Oracle'}`:'waiting for a new signal';
    $('oracleAuditStatus').textContent=`Audit: ${x.audit?.count||0} local records · ${x.audit?.overflow_total||0} overflow evictions · ${x.audit?.write_failures_since_restart||0} write failures · ${x.audit?.dropped_pending_writes_since_restart||0} overload drops · Oracle audit upload not configured · WebSocket ACK: ${ackText}.`;
    if(x.endpoint&&!$('oracleEndpoint').value)$('oracleEndpoint').value=x.endpoint;
    if(x.receiverId&&!$('oracleReceiverId').value)$('oracleReceiverId').value=x.receiverId;
  }catch{$('oracleReceiverStatus').textContent='Receiver status unavailable.';}
}
$('oracleSave').addEventListener('click',async()=>{
  const b=$('oracleSave');b.disabled=true;
  try{
    const res=await chrome.runtime.sendMessage({type:'COMMAND',command:'ORACLE_SIGNAL_CONFIG',config:{endpoint:value('oracleEndpoint'),receiverId:value('oracleReceiverId'),credential:value('oracleCredential')}});
    $('oracleCredential').value='';
    $('oracleReceiverFeedback').textContent=res?.ok?'Receiver connection saved.':res?.error||'Could not save receiver.';
    await updateReceiver();
  }catch{$('oracleReceiverFeedback').textContent='Cannot reach the extension service worker.';}
  finally{b.disabled=false;}
});
$('oracleTest').addEventListener('click',async()=>{
  const b=$('oracleTest');b.disabled=true;$('oracleReceiverFeedback').textContent='Checking authenticated Oracle connection…';
  try{const res=await chrome.runtime.sendMessage({type:'COMMAND',command:'ORACLE_SIGNAL_TEST'});
    $('oracleReceiverFeedback').textContent=res?.ok?'Oracle authenticated this receiver. No job search was triggered.':res?.error||'Receiver connection test failed.';
    await updateReceiver();
  }catch{$('oracleReceiverFeedback').textContent='Receiver connection test unavailable.';}
  finally{b.disabled=false;}
});
$('oracleRemove').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({type:'COMMAND',command:'ORACLE_SIGNAL_REMOVE'});
  $('oracleCredential').value='';$('oracleReceiverFeedback').textContent='Receiver credential removed; Oracle listener disconnected.';
  await updateReceiver();
});
receiverAppearance();
await updateReceiver();
await updateRelay();
await updateState();
