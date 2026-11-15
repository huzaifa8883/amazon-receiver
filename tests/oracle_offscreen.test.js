import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../offscreen.js',import.meta.url),'utf8');
function harness(){
  let listener,worker;
  class FakeWorker{
    constructor(){this.sent=[];worker=this;}
    postMessage(message){
      this.sent.push(message);
      if(message.type==='test')queueMicrotask(()=>this.onmessage?.({data:{
        type:'ORACLE_SIGNAL_TEST_RESULT',requestId:message.requestId,result:{ok:true,state:'authenticated'}
      }}));
    }
    terminate(){}
  }
  const chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async()=>({ok:true})}};
  vm.runInNewContext(source,{Worker:FakeWorker,chrome,setTimeout,clearTimeout,console,queueMicrotask});
  return {get listener(){return listener;},get worker(){return worker;}};
}

test('offscreen read-only connection probe returns authentication and does not send an application event',async()=>{
  const h=harness();
  const result=await new Promise(resolve=>{
    const keepAlive=h.listener({type:'ORACLE_SIGNAL_TEST',config:{endpoint:'wss://oracle.test/ws',receiverId:'receiver-01',credential:'test-key-only'}},null,resolve);
    assert.equal(keepAlive,true,'offscreen listener must keep async reply channel alive');
  });
  assert.deepEqual(result,{ok:true,state:'authenticated'});
  assert.deepEqual(h.worker.sent.map(m=>m.type),['test']);
});

test('offscreen forwards the background durable receipt before permitting transport ACK',async()=>{
  const h=harness();
  const signal={type:'new_job_detected',signal_id:'sig-61',job_id:'cardtext-v1-123'};
  h.worker.onmessage({data:{type:'ORACLE_SIGNAL_EVENT',signal,requestId:81}});
  for(let i=0;i<4;i++)await Promise.resolve();
  const response=h.worker.sent.find(x=>x.type==='ORACLE_SIGNAL_DELIVERY_RESULT'&&x.requestId===81);
  assert(response, 'Offscreen must reply to the worker rather than drop the browser result');
  assert.equal(response.result.ok,true);
});

test('offscreen reports background persistence refusal to signal worker',async()=>{
  const source=fs.readFileSync(new URL('../offscreen.js',import.meta.url),'utf8');
  let worker;
  class MockWorker{
    constructor(){this.sent=[];worker=this;}
    postMessage(m){this.sent.push(m);}
    terminate(){}
  }
  let listener;
  const chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async()=>({ok:false,error:'queue full'})}};
  vm.runInNewContext(source,{Worker:MockWorker,chrome,setTimeout,clearTimeout,console});
  worker.onmessage({data:{type:'ORACLE_SIGNAL_EVENT',signal:{type:'new_job_detected'},requestId:44}});
  for(let i=0;i<4;i++)await Promise.resolve();
  const msg=worker.sent.find(x=>x.type==='ORACLE_SIGNAL_DELIVERY_RESULT');
  assert(msg,'a failed persistence must be reported');
  assert.equal(msg.result.ok,false);
});
