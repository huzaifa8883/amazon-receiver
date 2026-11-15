import test from 'node:test';
import assert from 'node:assert/strict';
const config={endpoint:'wss://example.invalid/v1/receivers/ws',receiverId:'receiver-01',credential:'ajr3_test-local-only-secret'};
class FakeWs{
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeWs.last=this;}
  send(data){this.sent.push(JSON.parse(data));}
  close(){this.readyState=3;}
  open(){this.readyState=1;this.onopen?.();}
  receive(data){this.onmessage?.({data:JSON.stringify(data)});}
}
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('real worker → controller receipt → WebSocket ACK bridge',async()=>{
  const oldWebSocket=globalThis.WebSocket,oldSelf=globalThis.self;
  const posted=[];
  globalThis.WebSocket=FakeWs;
  globalThis.self={postMessage:m=>posted.push(m)};
  try{
    await import('../src/signal_worker.js?real-bridge-test');
    self.onmessage({data:{type:'connect',config}});
    const ws=FakeWs.last;
    ws.open();ws.receive({type:'authenticated',receiver_id:'receiver-01'});
    const broadcast={type:'new_job_detected',signal_id:'sig-74',job_id:'cardtext-v1-'+'c'.repeat(64),detected_at:new Date().toISOString()};
    ws.receive(broadcast);await tick();
    const sentToController=posted.find(x=>x.type==='ORACLE_SIGNAL_EVENT');
    assert(sentToController,'worker must pass normalized signal to controller');
    assert.equal(sentToController.signal.event_id,'sig-74');
    assert.equal(sentToController.signal.signal_id,'sig-74');
    assert.equal(ws.sent.filter(x=>x.type==='ack').length,0,'do not ACK before durable storage');
    self.onmessage({data:{type:'ORACLE_SIGNAL_DELIVERY_RESULT',requestId:sentToController.requestId,result:{ok:true}}});
    await tick();
    assert.deepEqual(ws.sent.at(-1),{type:'ack',signal_id:'sig-74'});
    ws.receive({type:'ping'});
    assert.deepEqual(ws.sent.at(-1),{type:'pong'});
    ws.receive({type:'ack_result',signal_id:'sig-74',accepted:true});
    assert(posted.some(x=>x.type==='ORACLE_SIGNAL_STATE'&&x.status.lastAck?.signalId==='sig-74'&&x.status.lastAck?.accepted));
    self.onmessage({data:{type:'disconnect'}});
  }finally{
    globalThis.WebSocket=oldWebSocket;globalThis.self=oldSelf;
  }
});
