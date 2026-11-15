/* Native Node worker. Storage must finish BEFORE Oracle ACK. */
import {createSignalSocket,testSignalConnection} from './signal_socket.js';
import WebSocket from 'ws';
export function startSignalWorker({config,persistSignal,onStatus=()=>{}}){
  const client=createSignalSocket({WebSocketClass:WebSocket,sendStatus:onStatus,
    sendSignal:signal=>persistSignal(signal)});
  const result=client.configure(config);
  if(!result.ok)throw Error(result.error);
  return {client,stop:()=>client.stop(),test:()=>testSignalConnection(config,{WebSocketClass:WebSocket})};
}
