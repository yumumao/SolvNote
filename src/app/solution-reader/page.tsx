"use client";
import {useEffect,useState} from 'react';
import {SolutionDocument,type SolutionSnapshot} from '@/components/solution-document';
import {SolutionShare} from '@/components/solution-share';
import {receiveSolutionReader} from '@/lib/solution-reader';
export default function SolutionReader(){
 const [snapshot,setSnapshot]=useState<SolutionSnapshot|null>(null),[expired,setExpired]=useState(false);
 useEffect(()=>{
  let cleanup:undefined|(()=>void);
  const start=setTimeout(()=>{
   try{cleanup=receiveSolutionReader(location.hash.slice(1),value=>{setSnapshot(value);history.replaceState(null,'',location.pathname)},()=>setExpired(true))}
   catch{setExpired(true)}
  },0);
  return ()=>{clearTimeout(start);cleanup?.()};
 },[]);
 return <main className="mx-auto max-w-4xl p-4 space-y-4" data-solution-reader>
  <header className="space-y-3"><h1 className="text-xl font-semibold">解题过程 · 本地阅读</h1><p className="text-sm text-muted-foreground">本地快照，不是公开分享链接。可在此分享图片或文字；刷新后请回原题重新打开。图片附件需主动勾选。</p>
  {snapshot&&<SolutionShare {...snapshot} initialSelection={snapshot} allowNewReader={false}/>}</header>
  {snapshot?<SolutionDocument snapshot={snapshot}/>:<p role="status">{expired?'阅读快照已失效，请回原题重新打开。':'正在接收本地快照，请保持原页面打开…'}</p>}
 </main>;
}
