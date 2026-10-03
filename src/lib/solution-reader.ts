import {parseSolutionSnapshot,type SolutionSnapshot} from './solution-snapshot';
const prefix='solvnote-solution-reader:';
const validToken=(s:string)=>/^[a-f0-9-]{36}$/.test(s);
/** Ephemeral same-origin handoff; no opener, storage, content in URL, or upload. */
export function openSolutionReader(value:SolutionSnapshot):void {
 const snapshot=parseSolutionSnapshot(value);if(!snapshot)throw Error('没有可阅读的题解');
 const token=crypto.randomUUID(),channel=new BroadcastChannel(prefix+token);
 const close=()=>{clearTimeout(timer);channel.close()};
 const timer=setTimeout(close,60000);
 channel.onmessage=event=>{if(event.data?.type==='ready')channel.postMessage({type:'snapshot',snapshot});else if(event.data?.type==='received')close()};
 try{window.open('/solution-reader#'+token,'_blank','noopener,noreferrer')}catch(error){close();throw error}
}
export function receiveSolutionReader(token:string,onSnapshot:(s:SolutionSnapshot)=>void,onExpired:()=>void):()=>void {
 if(!validToken(token)){onExpired();return ()=>{}}
 const channel=new BroadcastChannel(prefix+token);let done=false;
 const close=()=>{done=true;clearInterval(retry);clearTimeout(timeout);channel.close()};
 const ready=()=>channel.postMessage({type:'ready'});
 const retry=setInterval(ready,500),timeout=setTimeout(()=>{close();onExpired()},60000);
 channel.onmessage=event=>{
  if(done||event.data?.type!=='snapshot')return;
  const snapshot=parseSolutionSnapshot(event.data.snapshot);if(!snapshot)return;
  channel.postMessage({type:'received'});close();onSnapshot(snapshot);
 };
 ready();return close;
}
