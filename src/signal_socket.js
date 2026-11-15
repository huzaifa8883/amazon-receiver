/* Production Oracle Stage 3/5E WebSocket protocol, read from receiver_api.py
   and receiver_store.py. Credentials are sent only in the authenticated WSS
   first frame; never put secrets in a URL or a source ZIP. */
import {validateOracleSignal,validateReceiverConfig} from './signal_rules.js';

export const receiverAuthMessage = ({receiverId,credential}) => ({
  type:'authenticate', receiver_id:receiverId, token:credential
});

export function createSignalSocket({WebSocketClass=WebSocket,clock=()=>Date.now(),random=Math.random,
  sendStatus=()=>{},sendSignal=()=>{},schedule=setTimeout,cancel=clearTimeout}={}){
  let ws=null,desired=null,reconnectTimer=null,authenticated=false,attempt=0,serial=0,lastAck=null;
  const emit=(state,error='')=>sendStatus({state,error,receiverId:desired?.receiverId||'',connected:state==='connected',at:clock(),lastAck});
  function close(){
    serial++;authenticated=false;
    if(reconnectTimer!==null){cancel(reconnectTimer);reconnectTimer=null;}
    if(ws){const old=ws;ws=null;try{old.close(1000,'receiver client reset');}catch{}}
  }
  function retry(){
    if(!desired)return;
    if(reconnectTimer!==null)cancel(reconnectTimer);
    const wait=Math.min(60000,Math.round(2000*Math.pow(2,Math.min(attempt++,5))*(.8+random()*.4)));
    emit('reconnecting','Oracle WebSocket disconnected; reconnection scheduled');
    reconnectTimer=schedule(()=>{reconnectTimer=null;connect();},wait);
  }
  function authenticationFailed(){
    desired=null;close();emit('auth_failed','Receiver authentication rejected. Check this receiver ID and its assigned key.');
  }
  function connect(){
    if(!desired)return;
    close();const current=++serial;
    const processing=new Set();
    emit('connecting');
    try{ws=new WebSocketClass(desired.endpoint);}catch{retry();return;}
    const socket=ws;
    socket.onopen=()=>{
      if(current!==serial)return;
      try{socket.send(JSON.stringify(receiverAuthMessage(desired)));emit('authenticating');}
      catch{try{socket.close();}catch{}retry();}
    };
    socket.onmessage=e=>{
      if(current!==serial||typeof e.data!=='string'||e.data.length>65536)return;
      let message;try{message=JSON.parse(e.data);}catch{return;}
      if(message?.type==='authenticated'&&message.receiver_id===desired?.receiverId){
        authenticated=true;attempt=0;emit('connected');return;
      }
      if(['auth_error','authentication_failed','unauthorized'].includes(message?.type)){
        authenticationFailed();return;
      }
      if(!authenticated)return;
      if(message?.type==='ping'){
        try{socket.send(JSON.stringify({type:'pong'}));}catch{try{socket.close();}catch{}}
        return;
      }
      if(message?.type==='ack_result'){
        if(/^sig-[1-9][0-9]{0,18}$/.test(message.signal_id||'')){
          lastAck={signalId:message.signal_id,accepted:message.accepted===true,at:clock()};
          emit('connected',message.accepted===true?'':'Oracle did not accept the signal acknowledgement; delivery can retry');
        }
        return;
      }
      if(message?.type==='pong')return;
      const signal=validateOracleSignal(message);
      if(!signal)return;
      const signalId=signal.signal_id;
      // The production broadcaster retries until it sees an ACK. Never ACK
      // until the background service worker has durably persisted the event.
      // Simultaneous retries of a still-pending delivery are coalesced here.
      if(signalId&&processing.has(signalId))return;
      if(signalId)processing.add(signalId);
      void Promise.resolve().then(()=>sendSignal(signal)).then(result=>{
        if(result?.ok!==true||!signalId)return;
        if(current===serial&&authenticated&&socket.readyState===1){
          try{socket.send(JSON.stringify({type:'ack',signal_id:signalId}));}
          catch{try{socket.close();}catch{}}
        }
      }).catch(()=>{/* An unpersisted signal is deliberately NOT acknowledged. */})
        .finally(()=>{if(signalId)processing.delete(signalId);});
    };
    socket.onerror=()=>{if(current===serial)emit('disconnected','WebSocket connection error');};
    socket.onclose=event=>{
      if(current!==serial)return;
      ws=null;authenticated=false;
      if(event?.code===1008||event?.code===4401||event?.code===4403){authenticationFailed();return;}
      retry();
    };
  }
  return {
    configure(c){
      const error=validateReceiverConfig(c);if(error)return {ok:false,error};
      desired={endpoint:c.endpoint,receiverId:c.receiverId,credential:c.credential};attempt=0;connect();return {ok:true};
    },
    stop(){desired=null;close();emit('stopped');return {ok:true};},
    state(){return {configured:!!desired,authenticated,receiverId:desired?.receiverId||'',readyState:ws?.readyState??null,lastAck};}
  };
}

/* Connection test is read-only: authenticate and close without processing a job
   signal or changing the active automation controller. */
export function testSignalConnection(c,{WebSocketClass=WebSocket,schedule=setTimeout,cancel=clearTimeout,timeoutMs=8000}={}){
  const error=validateReceiverConfig(c);
  if(error)return Promise.resolve({ok:false,error});
  return new Promise(resolve=>{
    let finished=false,ws=null;
    const settle=result=>{
      if(finished)return;finished=true;cancel(timeout);
      if(ws)try{ws.close(1000,'connection test complete');}catch{}
      resolve(result);
    };
    const timeout=schedule(()=>settle({ok:false,error:'Receiver authentication test timed out'}),timeoutMs);
    try{ws=new WebSocketClass(c.endpoint);}catch{return settle({ok:false,error:'Could not open secure WebSocket'});}
    ws.onopen=()=>{try{ws.send(JSON.stringify(receiverAuthMessage(c)));}catch{settle({ok:false,error:'Could not send receiver authentication'});}};
    ws.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data);}catch{return;}
      if(msg?.type==='authenticated'&&msg.receiver_id===c.receiverId)settle({ok:true,state:'authenticated'});
      else if(['auth_error','authentication_failed','unauthorized'].includes(msg?.type))settle({ok:false,error:'Oracle rejected the assigned receiver ID or key'});
    };
    ws.onerror=()=>settle({ok:false,error:'WebSocket connection or TLS error'});
    ws.onclose=()=>settle({ok:false,error:'Oracle closed the connection before confirming authentication'});
  });
}
