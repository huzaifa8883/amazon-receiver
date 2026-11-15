/* Offscreen document hosts a real Web Worker (WORKERS reason), and retains
   the existing optional audio notifications (AUDIO_PLAYBACK reason). */
let ctx=null;let nodes=[],desired=null,lastSocketStatus={state:'stopped'};
let worker=null,workerFailures=0,workerRetry=null;
const pendingTests=new Map();let nextTestId=0;
function newWorker(){
  if(worker)try{worker.terminate();}catch{}
  worker=new Worker('src/signal_worker.js',{type:'module'});
  worker.onmessage=e=>{
    const message=e.data;
    if(message?.type==='ORACLE_SIGNAL_STATE'){
      lastSocketStatus=message.status;
      if(lastSocketStatus.connected)workerFailures=0;
      chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_STATE',status:message.status}).catch(()=>{});
    }else if(message?.type==='ORACLE_SIGNAL_EVENT'){
      // A fire-and-forget forwarder previously lost ACK and job-refresh work.
      // Return the controller's persistence result to the SAME worker, and
      // never claim acceptance when the background service worker is offline.
      const source=worker;
      void chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_EVENT',signal:message.signal})
        .then(result=>{
          if(worker===source)source.postMessage({type:'ORACLE_SIGNAL_DELIVERY_RESULT',requestId:message.requestId,result:{ok:result?.ok===true}});
        }).catch(()=>{
          if(worker===source)source.postMessage({type:'ORACLE_SIGNAL_DELIVERY_RESULT',requestId:message.requestId,result:{ok:false}});
        });
    }else if(message?.type==='ORACLE_SIGNAL_TEST_RESULT'){
      const finish=pendingTests.get(message.requestId);if(finish)finish(message.result);
    }else if(message?.type==='ORACLE_SIGNAL_PONG'){
      lastSocketStatus={...lastSocketStatus,...message.status};
    }
  };
  worker.onerror=()=>{
    lastSocketStatus={state:'disconnected',connected:false,error:'Signal worker failed; bounded restart pending'};
    chrome.runtime.sendMessage({type:'ORACLE_SIGNAL_STATE',status:lastSocketStatus}).catch(()=>{});
    try{worker.terminate();}catch{}
    worker=null;
    if(workerRetry!==null)clearTimeout(workerRetry);
    if(++workerFailures<=5 && desired){
      workerRetry=setTimeout(()=>{workerRetry=null;newWorker();if(desired)worker.postMessage({type:'connect',config:desired});},Math.min(60000,2000*2**(workerFailures-1)));
    }
  };
}
newWorker();
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
  if(msg?.type==='AUDIO_BEEP'){
    try{
      ctx=ctx||new AudioContext();ctx.resume();
      const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;
      osc.type='sine';osc.frequency.setValueAtTime(880,t);gain.gain.setValueAtTime(.001,t);
      gain.gain.exponentialRampToValueAtTime(.25,t+.015);gain.gain.exponentialRampToValueAtTime(.001,t+.25);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.27);nodes.push(osc);
      osc.onended=()=>{nodes=nodes.filter(n=>n!==osc);osc.disconnect();gain.disconnect();};
    }catch(e){console.warn('Sound could not play:',e);}
  }else if(msg?.type==='AUDIO_STOP'){
    for(const n of nodes){try{n.stop();}catch{}}nodes=[];
  }else if(msg?.type==='ORACLE_SIGNAL_CONNECT'){
    desired=msg.config;
    try{if(!worker)newWorker();worker.postMessage({type:'connect',config:desired});reply({ok:true});}
    catch{reply({ok:false,error:'Signal worker unavailable'});}
  }else if(msg?.type==='ORACLE_SIGNAL_DISCONNECT'){
    desired=null;workerFailures=0;if(workerRetry!==null){clearTimeout(workerRetry);workerRetry=null;}
    try{worker?.postMessage({type:'disconnect'});}catch{}
    lastSocketStatus={state:'stopped',connected:false};reply({ok:true});
  }else if(msg?.type==='ORACLE_SIGNAL_TEST'){
    const requestId=++nextTestId;let done=false;
    const timeout=setTimeout(()=>finish({ok:false,error:'Receiver test timed out'}),11000);
    function finish(result){if(done)return;done=true;clearTimeout(timeout);pendingTests.delete(requestId);reply(result);}
    pendingTests.set(requestId,finish);
    try{if(!worker)newWorker();worker.postMessage({type:'test',config:msg.config,requestId});}
    catch{finish({ok:false,error:'Receiver test worker unavailable'});}
    return true;
  }else if(msg?.type==='ORACLE_SIGNAL_PING'){
    try{worker?.postMessage({type:'ping'});}catch{}
    reply({ok:!!worker,status:{configured:!!desired,authenticated:!!lastSocketStatus.connected}});
  }
  return false;
});
