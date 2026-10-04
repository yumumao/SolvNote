"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ReadingModeButton } from "./reading-mode-button";
import { Button } from "./ui/button";
import { AIWorkProgress } from "./ai-work-progress";
import { SolutionDocument, type SolutionContext, type SolutionSnapshot } from "./solution-document";
import { saveBlob, solutionPlainText } from "@/lib/solution-share";
import {openSolutionReader} from "@/lib/solution-reader";
import {parseSolutionSnapshot} from "@/lib/solution-snapshot";
import type { SolutionImage } from "@/lib/solution-images";

type PreviewImage=SolutionImage&{url:string};
export function SolutionShare({analysis,questionText,answerText,originalImage,basePlan,auxiliaryPlan,initialSelection,allowNewReader=true,inline=false,fitWidth=false}:{analysis:string;initialSelection?:SolutionSnapshot;allowNewReader?:boolean;inline?:boolean;fitWidth?:boolean}&SolutionContext){
 const makeSnapshot=()=>parseSolutionSnapshot({analysis,questionText,answerText,originalImage,basePlan,auxiliaryPlan,fitWidth:initialSelection?.fitWidth??fitWidth,includeLatex:initialSelection?.includeLatex??true,includeQuestion:initialSelection?.includeQuestion??false,includeAnswer:initialSelection?.includeAnswer??true,includeOriginal:initialSelection?.includeOriginal??false,includeBase:initialSelection?.includeBase??false,includeAuxiliary:initialSelection?.includeAuxiliary??true});
 const [snapshot,setSnapshot]=useState<SolutionSnapshot|null>(()=>inline?makeSnapshot():null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[text,setText]=useState<string|null>(null),[images,setImages]=useState<PreviewImage[]>([]);
 const [fileShare,setFileShare]=useState(false);
 const preview=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDialogElement>(null),urls=useRef<string[]>([]),operation=useRef(0),lock=useRef(false);
 const title=useId();
 const clearImages=()=>{urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current=[];setImages([]);setFileShare(false)};
 useEffect(()=>()=>{operation.current++;urls.current.forEach(url=>URL.revokeObjectURL(url))},[]);
 useEffect(()=>{const d=dialog.current;if(!d)return;if(snapshot&&!d.open){if(d.showModal)d.showModal();else d.setAttribute('open','')}else if(!snapshot&&d.open){if(d.close)d.close();else d.removeAttribute('open')}},[snapshot]);
 const close=()=>{operation.current++;lock.current=false;setBusy(false);setSnapshot(null);setText(null);clearImages()};

 const open=()=>{clearImages();setMessage('');setText(null);setSnapshot(makeSnapshot())};
 const select=(field:'includeQuestion'|'includeAnswer'|'includeOriginal'|'includeBase'|'includeAuxiliary'|'fitWidth'|'includeLatex',checked:boolean)=>{
  if(lock.current)return;clearImages();setMessage('');
  setSnapshot(s=>{
   if(!s)return s;
   const next={...s,[field]:checked};
   // Link only on an explicit off-to-on question toggle, never on mount or re-render.
   // Validated redraws take priority; every image remains independently selectable.
   if(field==='includeQuestion'&&checked&&!s.includeQuestion){
    if(s.basePlan)next.includeBase=true;
    else if(s.originalImage)next.includeOriginal=true;
   }
   return next;
  });
 };
 const documentNode=()=>preview.current?.querySelector<HTMLElement>('[data-solution-document]');
 const read=(value:SolutionSnapshot|null)=>{if(value){try{openSolutionReader(value);setMessage('已请求打开本地阅读页；若未打开，请允许浏览器弹出新标签。')}catch{setMessage('新标签打开失败，请使用分享预览或下载。')}}};
 const textOpen=text!==null;
 useLayoutEffect(()=>{
  const el=preview.current?.querySelector<HTMLElement>('[data-solution-document]');
  if(!textOpen||!el)return;
  // Synchronize derived text with the committed preview DOM, not an older selection.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setText(solutionPlainText(el,{includeLatex:snapshot?.includeLatex}));
 },[snapshot,textOpen]);
 const prepareText=()=>{if(textOpen){setText(null);setMessage('');return}const el=documentNode();if(el){setText(solutionPlainText(el,{includeLatex:snapshot?.includeLatex}));setMessage('文字已准备好。图片内容请使用图片分享；可切换是否保留LaTeX标记。')}};
 const copy=async()=>{if(text===null)return;try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(text);setMessage('文字已复制。')}catch{setMessage('浏览器不允许自动复制，请选中下方文字后手动复制。')}};
 const shareText=async()=>{if(text===null)return;try{await navigator.share({title:'解题过程',text});setMessage('已交给系统分享面板。')}catch(e){setMessage(e instanceof DOMException&&e.name==='AbortError'?'已取消分享。':'系统分享不可用，请复制文字或下载文本。')}};
 const generate=async()=>{
  if(lock.current)return;const el=documentNode();if(!el)return;lock.current=true;const ticket=++operation.current;setBusy(true);setMessage('');clearImages();
  try{const {renderSolutionImages}=await import('@/lib/solution-images');const result=await renderSolutionImages(el);if(ticket!==operation.current)return;
   const next=result.map(image=>({...image,url:URL.createObjectURL(image.blob)}));urls.current=next.map(i=>i.url);setImages(next);
   const files=result.map(i=>new File([i.blob],i.name,{type:'image/png'}));let can=false;try{can=!!navigator.share&&!!navigator.canShare?.({files})}catch{/* download remains available */}setFileShare(can);setMessage(`已生成${next.length}张图片，请预览后下载或分享。`);
  }catch(e){if(ticket===operation.current)setMessage(e instanceof Error?e.message:'图片生成失败，请使用文字分享。')}
  finally{if(ticket===operation.current){lock.current=false;setBusy(false)}}
 };
 const shareImages=async()=>{if(!images.length)return;try{await navigator.share({title:'解题过程',files:images.map(i=>new File([i.blob],i.name,{type:'image/png'}))});setMessage('已交给系统分享面板。')}catch(e){setMessage(e instanceof DOMException&&e.name==='AbortError'?'已取消分享。':'系统分享不可用，请逐张下载图片。')}};
 const workspace=snapshot&&<>
    <fieldset data-solution-options disabled={busy} className="my-4 flex flex-wrap gap-4 text-sm">
     {snapshot.questionText?.trim()&&<label className="flex items-center gap-2"><input type="checkbox" checked={snapshot.includeQuestion} onChange={e=>select('includeQuestion',e.target.checked)}/>附带题干</label>}
     {snapshot.answerText?.trim()&&<label className="flex items-center gap-2"><input type="checkbox" checked={snapshot.includeAnswer} onChange={e=>select('includeAnswer',e.target.checked)}/>附带参考答案</label>}
     {snapshot.originalImage&&<label className="flex items-center gap-2"><input type="checkbox" checked={!!snapshot.includeOriginal} onChange={e=>select('includeOriginal',e.target.checked)}/>附带原图</label>}
     {snapshot.basePlan&&<label className="flex items-center gap-2"><input type="checkbox" checked={!!snapshot.includeBase} onChange={e=>select('includeBase',e.target.checked)}/>附带原题重绘（第一步）</label>}
     {snapshot.auxiliaryPlan&&<label className="flex items-center gap-2"><input type="checkbox" checked={!!snapshot.includeAuxiliary} onChange={e=>select('includeAuxiliary',e.target.checked)}/>附带辅助线图（第二步）</label>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2 mb-3">{!inline&&allowNewReader&&<Button type="button" size="sm" variant="outline" onClick={()=>read(snapshot)}>在新标签预览</Button>}<ReadingModeButton fitWidth={!!snapshot.fitWidth} disabled={busy} onChange={value=>select('fitWidth',value)}/><Button type="button" size="sm" disabled={busy} onClick={generate}>生成分享长图</Button><div role="group" aria-label="文字分享选项" className="inline-flex h-8 shrink-0 items-stretch rounded-md"><Button type="button" size="sm" variant="outline" className="rounded-r-none" aria-expanded={textOpen} onClick={prepareText}>{textOpen?'收起分享文字':'准备分享文字'}</Button><label className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r-md border border-l-0 bg-background px-2.5 text-sm shadow-xs"><input type="checkbox" checked={snapshot.includeLatex!==false} disabled={busy} onChange={e=>select('includeLatex',e.target.checked)}/>保留LaTeX标记</label></div></div>
    <p className="text-xs text-muted-foreground mb-3">长内容自动按步骤分成多张图，避免截断公式；过长的单一步骤请先分段。修改勾选后需要重新生成。适合宽度模式会按当前阅读宽度生成图片。</p>
    <AIWorkProgress active={busy} label="本地分享图片生成" compact/>
    {message&&<p role="status" className="my-3 text-sm">{message}</p>}
    {text!==null&&<section className="space-y-2 my-4" aria-label="分享文字"><textarea aria-label="可复制的分享文字" readOnly value={text} className="w-full min-h-48 rounded-md border p-3 text-sm" onFocus={e=>e.currentTarget.select()}/><div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={copy}>复制文字</Button>{typeof navigator!=='undefined'&&!!navigator.share&&<Button type="button" size="sm" variant="outline" onClick={shareText}>系统分享文字</Button>}<Button type="button" size="sm" variant="outline" onClick={()=>saveBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),'solvnote-solution.txt')}>下载文本</Button></div></section>}
    {images.length>0&&<section aria-label="分享图片" className="space-y-2 my-4">
     <nav aria-label="长图下载" className="space-y-2">
      <p className="text-sm">共{images.length}张长图，下方连续预览。所有下载与查看入口都在这里：</p>
      <div className="flex flex-wrap items-center gap-2">
       {fileShare&&<Button type="button" size="sm" onClick={shareImages}>系统分享图片</Button>}
       {images.map((image,index)=><div key={image.url} className="inline-flex items-center gap-2 rounded-md border px-2.5 h-8 text-sm">
        <a className="underline text-blue-600" href={image.url} download={image.name}>下载第{index+1}张图片</a>
        <a className="underline text-blue-600" href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`在新标签查看第${index+1}张图片`}>查看</a>
       </div>)}
      </div>
     </nav>
     <div data-solution-image-stack className="flex flex-col items-start gap-1">
      {images.map((image,index)=><figure key={image.url} aria-label={`第${index+1}/${images.length}张分享图`} className="m-0 max-w-full">
       {/* eslint-disable-next-line @next/next/no-img-element -- generated local blob preview */}
       <img src={image.url} alt={`解题过程分享图${index+1}`} className="block max-w-full h-auto border"/>
      </figure>)}
     </div>
    </section>}
    <div ref={preview} className="rounded-lg border overflow-hidden"><SolutionDocument snapshot={snapshot}/></div>
 </>;
 if(inline)return <div data-solution-actions data-solution-inline className="min-w-0 space-y-3">{workspace}</div>;
 if(!analysis.trim())return null;
 return <div data-solution-actions className="space-y-2">
  <div className="flex flex-wrap gap-2">{allowNewReader&&<Button type="button" size="sm" variant="outline" onClick={()=>read(makeSnapshot())}>新标签阅读</Button>}<Button type="button" size="sm" variant="outline" onClick={open}>分享解题过程</Button></div>
  {!snapshot&&message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}
  <dialog data-solution-dialog ref={dialog} aria-labelledby={title} onCancel={e=>{e.preventDefault();e.stopPropagation();close()}} onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation()}} className="fixed inset-0 m-auto hidden w-[calc(100%-1rem)] max-w-4xl max-h-[90dvh] flex-col overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 open:flex">
   {snapshot&&<>
    <button type="button" aria-label="关闭解题分享" onClick={close} className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6 inline-flex size-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 shadow-sm hover:bg-red-200 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-300">✕</button>
    <div data-solution-dialog-scroll className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
    <h2 id={title} className="pr-12 text-xl font-semibold">分享解题过程</h2>
    <p className="mt-2 text-sm text-muted-foreground">仅在本机生成快照，不上传题目、不创建公开链接。默认不附带题干；勾选题干时优先带上第一步重绘，没有重绘则带上可用原图，图片可单独取消。参考答案和已生成的第二步辅助线图仍默认选中；不含错因、错误作答或账户信息。</p>
    {workspace}
   </div></>}
  </dialog>
 </div>;
}
