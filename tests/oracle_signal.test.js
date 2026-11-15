import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOracleSignal,validateReceiverConfig,validSignalEndpoint,enqueueSignal,trimSeenSignals,shouldCompleteSignalCycle} from '../src/signal_rules.js';
import {createSignalSocket,testSignalConnection,receiverAuthMessage} from '../src/signal_socket.js';
const sample=()=>({type:'new_job_detected',event_id:crypto.randomUUID(),job_id:'JOB-UK-123',detected_at:new Date().toISOString(),detector_id:'detector-01'});
test('only secure WSS connections with receiver-specific credentials are allowed',()=>{
  assert.equal(validSignalEndpoint('wss://oracle.example.org/v1/signals'),true);
  for(const u of ['https://145-241-233-33.sslip.io/v1/events','ws://oracle.example.org/','wss://token@oracle.example.org/s','wss://oracle.example.org/s?key=123'])assert.equal(validSignalEndpoint(u),false);
  assert.equal(validateReceiverConfig({endpoint:'wss://oracle.example.org/v1/signals',receiverId:'receiver-01',credential:'separate-device-secret-123'}),null);
  assert.ok(validateReceiverConfig({endpoint:'wss://oracle.example.org/v1/signals',receiverId:'receiver-01',credential:'short'}));
});
test('signal schema rejects malformed and unsupported messages',()=>{
  const valid=sample();assert.deepEqual(validateOracleSignal(valid),valid);
  assert.equal(validateOracleSignal({...valid,type:'changed_job_detected'})?.type,'changed_job_detected');
  for(const data of [{...valid,type:'stop'}, {...valid,event_id:''},{...valid,job_id:'bad space'}, {...valid,detected_at:'bad'}, {...valid,detector_id:''}])assert.equal(validateOracleSignal(data),null);
});
test('bounded pending queue and dedup preserve order',()=>{
  const a=sample(),b=sample();let pending=[];
  pending=enqueueSignal(pending,a).queue;
  assert.equal(enqueueSignal(pending,a).added,false);
  pending=enqueueSignal(pending,b).queue;
  assert.deepEqual(pending.map(s=>s.event_id),[a.event_id,b.event_id]);
});
test('recent event-id history is persisted and expired IDs pruned',()=>{
  const now=Date.now(),a=sample().event_id;
  assert.deepEqual(trimSeenSignals([{id:a,at:now},{id:a,at:now},{id:'old',at:now-25*3600000}],now),[{id:a,at:now}]);
});
test('Oracle signal cycle waits for stable Recommended results to finish',()=>{
  const snap={mode:'oracle',active:true,recommended:'yes',loading:false,availableCount:0,signature:'job-key',firstEmptyAt:Date.now()-1600};
  assert.equal(shouldCompleteSignalCycle(snap),true);
  assert.equal(shouldCompleteSignalCycle({...snap,loading:true}),false);
  assert.equal(shouldCompleteSignalCycle({...snap,availableCount:1}),false);
  assert.equal(shouldCompleteSignalCycle({...snap,firstEmptyAt:Date.now()}),false);
});
class FakeWebSocket{
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeWebSocket.last=this;}
  send(s){this.sent.push(JSON.parse(s));}
  close(){this.readyState=3;}
  open(){this.readyState=1;this.onopen?.();}
  receive(data){this.onmessage?.({data:JSON.stringify(data)});}
}
test('WSS client authenticates before accepting events, sends no credential in URL, stops cleanly',async()=>{
  const states=[],seen=[];
  const client=createSignalSocket({WebSocketClass:FakeWebSocket,sendStatus:x=>states.push(x),sendSignal:x=>seen.push(x),random:()=>.5});
  const credential='device-only-secret-string';
  assert.equal(client.configure({endpoint:'wss://oracle.example.org/v1/signals',receiverId:'receiver-01',credential}).ok,true);
  const socket=FakeWebSocket.last;assert.ok(!socket.url.includes(credential));
  socket.open();
  assert.equal(socket.sent[0].type,'authenticate');assert.equal(socket.sent[0].token,credential);assert.deepEqual(socket.sent[0],{type:'authenticate',receiver_id:'receiver-01',token:credential});
  socket.receive(sample());assert.equal(seen.length,0,'must not accept events before auth success');
  socket.receive({type:'authenticated',receiver_id:'receiver-01'});
  socket.receive(sample());await Promise.resolve();await Promise.resolve();assert.equal(seen.length,1);
  client.stop();assert.equal(client.state().authenticated,false);
});
test('WSS authentication failure disables reconnect rather than looping',()=>{
  const states=[];let retries=0;
  const client=createSignalSocket({WebSocketClass:FakeWebSocket,sendStatus:x=>states.push(x),sendSignal:()=>{},schedule:()=>{retries++;return 1;}});
  client.configure({endpoint:'wss://oracle.example.org/v1/signals',receiverId:'receiver-01',credential:'device-secret-123456'});
  FakeWebSocket.last.open();FakeWebSocket.last.receive({type:'auth_error'});
  assert.equal(client.state().configured,false);
  assert.equal(retries,0);
  assert.equal(states.at(-1).state,'auth_failed');
});

test('read-only connection probe authenticates without triggering any job action',async()=>{
  const opts={endpoint:'wss://oracle.example.org/v1/receivers/ws',receiverId:'receiver-01',credential:'local-device-secret-12345'};
  const check=testSignalConnection(opts,{WebSocketClass:FakeWebSocket,timeoutMs:500});
  const ws=FakeWebSocket.last;ws.open();
  assert.deepEqual(ws.sent,[receiverAuthMessage(opts)]);
  ws.receive({type:'authenticated',receiver_id:'receiver-01'});
  assert.deepEqual(await check,{ok:true,state:'authenticated'});
  assert.equal(ws.readyState,3);
});
test('connection probe rejects wrong receiver identity and does not send a job command',async()=>{
  const opts={endpoint:'wss://oracle.example.org/v1/receivers/ws',receiverId:'receiver-01',credential:'local-device-secret-12345'};
  const check=testSignalConnection(opts,{WebSocketClass:FakeWebSocket,timeoutMs:500});
  const ws=FakeWebSocket.last;ws.open();ws.receive({type:'auth_error'});
  assert.deepEqual(await check,{ok:false,error:'Oracle rejected the assigned receiver ID or key'});
});
test('receiver emits no invented acknowledgement payloads for sample signals',async()=>{
  const client=createSignalSocket({WebSocketClass:FakeWebSocket,sendSignal:()=>({ok:true})});
  client.configure({endpoint:'wss://oracle.example.org/v1/receivers/ws',receiverId:'receiver-01',credential:'local-device-secret-12345'});
  const ws=FakeWebSocket.last;ws.open();ws.receive({type:'authenticated',receiver_id:'receiver-01'});
  ws.receive(sample());
  await Promise.resolve();
  assert.equal(ws.sent.length,1,'only tested authentication protocol is emitted');
  client.stop();
});
