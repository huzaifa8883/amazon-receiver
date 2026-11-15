import test from 'node:test';
import assert from 'node:assert/strict';
import {createSignalSocket} from '../src/signal_socket.js';
import {validateOracleSignal} from '../src/signal_rules.js';

const config={endpoint:'wss://test.invalid/v1/receivers/ws',receiverId:'receiver-01',credential:'ajr3_example_opaque_test_secret'};
const signal=(n=61)=>({type:'job_card_changed',signal_id:`sig-${n}`,job_id:`cardtext-v1-${'a'.repeat(64)}`,
 content_version:`${'b'.repeat(64)}:reappeared:${n}`,detected_at:new Date().toISOString()});
class FakeSocket{
 static OPEN=1;
 constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeSocket.last=this;}
 send(data){if(this.readyState!==1)throw Error('socket not open');this.sent.push(JSON.parse(data));}
 close(){this.readyState=3;this.onclose?.({code:1000});}
 open(){this.readyState=1;this.onopen?.();}
 receive(data){this.onmessage?.({data:JSON.stringify(data)});}
}
const drain=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const begin=(callback,status=()=>{})=>{
 const client=createSignalSocket({WebSocketClass:FakeSocket,sendSignal:callback,sendStatus:status,random:()=>.5});
 assert.equal(client.configure(config).ok,true);
 const s=FakeSocket.last;s.open();s.receive({type:'authenticated',receiver_id:'receiver-01'});
 return {client,s};
};

test('production broadcast uses Oracle signal_id without requiring nonexistent detector_id',()=>{
 const x=signal(63);const normalized=validateOracleSignal(x);
 assert(normalized);
 assert.equal(normalized.event_id,'sig-63');
 assert.equal(normalized.signal_id,'sig-63');
 assert.equal(Object.hasOwn(normalized,'detector_id'),false);
 assert.equal(normalized.content_version,x.content_version);
 assert.equal(validateOracleSignal({...x,signal_id:'other'}),null);
 assert.equal(validateOracleSignal({...x,signal_id:'sig-0'}),null);
 assert.equal(validateOracleSignal({...x,event_id:'spoofed'}),null);
});

test('Oracle ping receives exact pong and stays connected',()=>{
 const {client,s}=begin(async()=>({ok:true}));
 s.receive({type:'ping'});
 assert.deepEqual(s.sent.at(-1),{type:'pong'});
 assert.equal(client.state().authenticated,true);
 client.stop();
});

test('accepted, durably queued signal gets exact Oracle ACK only AFTER local confirmation',async()=>{
 let finish;const seen=[];const statuses=[];
 const {client,s}=begin(event=>{seen.push(event);return new Promise(resolve=>{finish=resolve;});}, x=>statuses.push(x));
 s.receive(signal(61));await drain();
 assert.equal(seen.length,1);
 assert.deepEqual(s.sent.map(x=>x.type),['authenticate']);
 // Redelivery while local persistence pending is coalesced.
 s.receive(signal(61));await drain();assert.equal(seen.length,1);
 finish({ok:true});await drain();
 assert.deepEqual(s.sent.at(-1),{type:'ack',signal_id:'sig-61'});
 s.receive({type:'ack_result',signal_id:'sig-61',accepted:true});
 assert.deepEqual(client.state().lastAck,{signalId:'sig-61',accepted:true,at:client.state().lastAck.at});
 assert(statuses.some(x=>x.lastAck?.accepted===true));
 // Server retry following an unrecorded ACK is safe: local dedup reports ok.
 s.receive(signal(61));await drain();assert.equal(seen.length,2);
 client.stop();
});

test('persistence failures are NOT acknowledged, allowing Oracle to retry',async()=>{
 let n=0;const {client,s}=begin(async()=>{n++;return {ok:n>1};});
 s.receive(signal(62));await drain();
 assert.equal(n,1);assert.equal(s.sent.filter(x=>x.type==='ack').length,0);
 s.receive(signal(62));await drain();
 assert.equal(n,2);assert.deepEqual(s.sent.at(-1),{type:'ack',signal_id:'sig-62'});
 client.stop();
});

test('stop or disconnect during persistence never sends ACK from stale connection',async()=>{
 let finish;const {client,s}=begin(()=>new Promise(resolve=>{finish=resolve}));
 s.receive(signal(63));await drain();client.stop();finish({ok:true});await drain();
 assert.equal(s.sent.some(x=>x.type==='ack'),false);
});

test('confirmed ACK rejection appears in status for later retry diagnostics',()=>{
 const state=[];const {client,s}=begin(async()=>({ok:true}),x=>state.push(x));
 s.receive({type:'ack_result',signal_id:'sig-64',accepted:false});
 assert.equal(state.at(-1).lastAck.accepted,false);
 assert.match(state.at(-1).error,/did not accept/);
 client.stop();
});
