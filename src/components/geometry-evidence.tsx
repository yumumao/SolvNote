"use client";
import {useState} from "react";
import type {Transcript} from "@/lib/ai-dialogue/types";
import {MarkdownRenderer} from "./markdown-renderer";
import {Button} from "./ui/button";
export function GeometryEvidence({transcript,image,revision,corrected=false,verified=false,disabled=false,answered=false,onCorrect}:{transcript:Transcript;image?:string;revision:number;corrected?:boolean;verified?:boolean;disabled?:boolean;answered?:boolean;onCorrect:(text:string,revision:number,saveOnly:boolean)=>Promise<boolean|undefined>}){
    const [draft,setDraft]=useState<string|null>(null),[baseRevision,setBaseRevision]=useState(revision);
    const stale=draft!==null && revision!==baseRevision;
    async function submit(saveOnly:boolean){if(draft!==null && !stale && await onCorrect(draft,baseRevision,saveOnly))setDraft(null);}
    return <section className="border rounded-lg p-4 space-y-3"><h3 className="font-semibold">识图题设与角标核对</h3>
        <p className="text-sm text-muted-foreground">{corrected?"当前采用人工修订，旧识读不会覆盖本版题设。":verified?"已进行一次独立角标核对，仍请留意小字和相邻射线。":"以下为机器转录，可直接对照原图修订，不必重新上传。"}</p>
        {!!transcript.geometry?.angles.length && <ul className="space-y-1">{transcript.geometry.angles.map(a=><li key={a.label}>∠{a.label} = ∠{a.arms[0]}{a.vertex}{a.arms[1]} · 顶点{a.vertex} · 射线{a.vertex}{a.arms[0]}、{a.vertex}{a.arms[1]}</li>)}</ul>}
        {image && <details><summary className="cursor-pointer">展开原图对照</summary>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="供核对的原始题图，未添加辅助线" className="max-w-full max-h-[600px] object-contain"/></details>}
        <details><summary className="cursor-pointer">查看完整识图转录</summary><MarkdownRenderer content={transcript.text}/></details>
        {draft===null?<Button variant="outline" disabled={disabled} onClick={()=>{setDraft(transcript.text);setBaseRevision(revision);}}>修订完整题设</Button>:<div className="space-y-2">
            <label className="block">完整修订题设<textarea aria-label="完整修订题设" className="w-full min-h-40 border rounded p-2 bg-background" maxLength={40000} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)}/></label>
            <p className="text-sm">这是完整替换，请保留所有必要条件。仅保存不调用AI；{answered?"已完成的答案重新解题将计新一轮。":"继续当前轮会调用AI，但不另扣问答轮数。"}</p>
            {stale && <p role="alert">会话版本已更新，草稿仍保留。请复制草稿后取消修订、核对新版再提交。</p>}
            <div className="flex gap-2 flex-wrap"><Button disabled={disabled||stale||!draft.trim()} onClick={()=>void submit(false)}>采用修订并继续{answered?"（新一轮）":""}</Button>{!answered && <Button variant="outline" disabled={disabled||stale||!draft.trim()} onClick={()=>void submit(true)}>仅保存修订</Button>}<Button variant="ghost" disabled={disabled} onClick={()=>setDraft(null)}>取消修订</Button></div>
        </div>}
    </section>;
}
