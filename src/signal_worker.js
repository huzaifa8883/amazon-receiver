/* Dedicated worker inside the existing offscreen document; no applicant data. */
import {createSignalSocket,testSignalConnection} from './signal_socket.js';
// Round-trip each incoming signal through the offscreen document to the
// background controller. Only a successful durable-queue response permits ACK.
let nextRequestId=0;
const pending=new Map();
function sendToController(signal){
  return new Promise(resolve=>{
    const requestId=++nextRequestId;
    const timeout=setTimeout(()=>{
      const item=pending.get(requestId);
      if(item){pending.delete(requestId);item.resolve({ok:false,error:'Background persistence timed out'});}
    },15000);
    pending.set(requestId,{resolve,timeout});
    try{self.postMessage({type:'ORACLE_SIGNAL_EVENT',signal,requestId});}
    catch{clearTimeout(timeout);pending.delete(requestId);resolve({ok:false});}
  });
}
const client=createSignalSocket({
  sendStatus:status=>self.postMessage({type:'ORACLE_SIGNAL_STATE',status}),
  sendSignal:sendToController
});
self.onmessage=e=>{
  const msg=e.data;
  if(msg?.type==='ORACLE_SIGNAL_DELIVERY_RESULT'){
    const item=pending.get(msg.requestId);
    if(item){pending.delete(msg.requestId);clearTimeout(item.timeout);item.resolve(msg.result?.ok===true?{ok:true}:{ok:false});}
  }
  if(msg?.type==='connect')client.configure(msg.config);
  if(msg?.type==='disconnect')client.stop();
  if(msg?.type==='ping')self.postMessage({type:'ORACLE_SIGNAL_PONG',status:client.state()});
  if(msg?.type==='test'){
    if(client.state().authenticated&&client.state().receiverId===msg.config?.receiverId){
      self.postMessage({type:'ORACLE_SIGNAL_TEST_RESULT',requestId:msg.requestId,result:{ok:true,state:'authenticated'}});
    }else{
      void testSignalConnection(msg.config).then(result=>self.postMessage({type:'ORACLE_SIGNAL_TEST_RESULT',requestId:msg.requestId,result}));
    }
  }
};
