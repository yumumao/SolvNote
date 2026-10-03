"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {apiClient,ApiError} from "@/lib/api-client";
import {drawingFailureMessage} from "@/lib/ai-drawing/diagnostics";
import type {IllustrationRequest,IllustrationResult} from "@/lib/ai-drawing/illustration-schema";
import {IllustrationComposer,safeIllustrationReference,type IllustrationInitialDraft} from "./illustration-composer";
import {IllustrationPreview,type IllustrationSettingsView} from "./illustration-settings";
import {AIWorkProgress} from "./ai-work-progress";
import {Button} from "./ui/button";

type Props={questionText:string;image?:string|null;requirements?:string;disabled?:boolean;onBusyChange?:(busy:boolean)=>void};
type LoadedDraft={id:number;source:string;initial:IllustrationInitialDraft;skippedImage:boolean};
/** Uses existing site authorization. This is text regeneration, not pixel-preserving image editing. */
export function QuestionIllustration({questionText,image,requirements="",disabled=false,onBusyChange}:Props){
    const source=JSON.stringify([questionText,image||"",requirements]);
    const [draft,setDraft]=useState<LoadedDraft>(),[settings,setSettings]=useState<IllustrationSettingsView>();
    const [busy,setBusy]=useState(false),[generating,setGenerating]=useState(false),[message,setMessage]=useState("");
    const [job,setJob]=useState(""),[result,setResult]=useState<IllustrationResult>();
    const pending=useRef(false),sequence=useRef(0),controller=useRef<AbortController|null>(null);
    useEffect(()=>()=>controller.current?.abort(),[]);
    const stale=!!draft&&draft.source!==source;
    function work(value:boolean){setBusy(value);onBusyChange?.(value);}
    async function load(){
        if(disabled||busy||pending.current)return;
        pending.current=true;work(true);setSettings(undefined);setMessage("正在读取已保存授权；此操作不保存设置、不调用AI。");
        const original=safeIllustrationReference(image||undefined);
        const snapshot={id:++sequence.current,source,initial:{text:questionText,requirements,image:original},skippedImage:!!image&&!original};
        try{const s=await apiClient.get<IllustrationSettingsView>("/api/ai/illustration-settings");setSettings(s);setDraft(snapshot);setMessage(s.enabled?"已载入题文。请核对原图描述、补充要求与最终提示词，再单独确认生图。不会覆盖原题图。":"尚未启用MiniMax创作配图，或连接配置已变更。请管理员到AI设置保存创作配图授权后重新载入。");}
        catch{setMessage("无法读取MiniMax创作配图设置。请确认管理员身份与已保存授权后重试；未调用AI。");}
        finally{pending.current=false;work(false);}
    }
    async function generate(prompt:string,ratio:IllustrationRequest["ratio"]){
        if(disabled||busy||pending.current||stale||!settings?.enabled||!prompt.trim()||prompt.trim().length>1500)return;
        pending.current=true;work(true);setGenerating(true);setResult(undefined);setJob("");
        setMessage("正在重新配图；不会自动重试。离开后可从我的AI任务取回，请勿重复提交。");
        const signal=new AbortController();controller.current=signal;
        try{const r=await apiClient.post<IllustrationResult>("/api/ai/drawing/illustration",{questionText:prompt.trim(),illustrationRatio:ratio,illustrationRevision:settings.revision,confirmIllustration:true},{signal:signal.signal,onJobAccepted:setJob});setResult(r);setMessage("重新配图完成，原题图未被替换。结果保留24小时，请及时下载；尺寸、角度与辅助线均需人工核对。");}
        catch(e){setMessage(drawingFailureMessage(e instanceof ApiError?(e.data as {message?:string})?.message:undefined));}
        finally{controller.current=null;pending.current=false;work(false);setGenerating(false);}
    }
    return <section className="space-y-3" aria-label="题目MiniMax重新配图">
        <h4 className="font-semibold">MiniMax重新配图（无需Gemini）</h4>
        <p className="text-sm text-muted-foreground">按当前题文、已核对的原图描述和补充要求重新生成。不是直接编辑原图像素，也不保证精确几何；可在补充要求中写明需要的辅助线，不把辅助线当作原题已知条件。答案和解析不会自动加入提示词。</p>
        <Button variant="outline" disabled={disabled||busy} onClick={()=>void load()}>载入当前题目并读取MiniMax设置</Button>
        <p className="text-xs text-muted-foreground">只读取AI设置中已保存的创作配图授权。再次载入会重置本区草稿和收费确认，不修改或自动启用配置。</p>
        <Link href="/admin/ai" className="underline text-sm">前往AI设置配置MiniMax创作配图</Link>
        {settings?.enabled&&<p className="text-sm">当前配图：{settings.providerName} · {settings.model}</p>}
        {stale&&<p role="alert">当前题目已变更，本区仍保留载入时的草稿。请重新载入并核对，旧提示词不能继续提交；已受理的任务仍使用提交时的内容，结果不会覆盖原题图。</p>}
        {draft?.skippedImage&&<p role="alert">原图未载入：只接受不超过6MiB的PNG/JPEG/WebP内嵌图片，不会读取外部图片地址。可手动上传或填写已核对的描述。</p>}
        {draft&&settings?.enabled&&<IllustrationComposer key={draft.id} initialDraft={draft.initial} disabled={disabled||busy||stale} enabled={settings.enabled&&!stale} authorization={JSON.stringify([settings.revision,settings.configRevision,settings.providerId,settings.model,draft.id,source])} onBusy={work} onGenerate={generate}/>}
        <AIWorkProgress active={generating} label="MiniMax重新配图"/>
        <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>
        <div className="flex flex-wrap gap-3 text-sm">{job&&<Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(job)}`}>查看本次配图任务（可取消/取回）</Link>}<Link className="underline" href="/ai-tasks">我的AI任务/取回配图</Link></div>
        {result&&<IllustrationPreview result={result}/>}
    </section>;
}
