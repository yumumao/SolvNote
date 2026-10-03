"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {apiClient,ApiError} from "@/lib/api-client";
import {drawingFailureMessage} from "@/lib/ai-drawing/diagnostics";
import {composeIllustrationPrompt,IllustrationDescriptionSchema,type IllustrationDraft,type IllustrationDescriptionResult} from "@/lib/ai-drawing/illustration-reference";
import type {IllustrationRequest} from "@/lib/ai-drawing/illustration-schema";
import {Button} from "./ui/button";
import {AIWorkProgress} from "./ai-work-progress";
export function IllustrationDescriptionPreview({result}:{result:unknown}){
    const value=result as Partial<IllustrationDescriptionResult>|null;
    const parsed=IllustrationDescriptionSchema.safeParse(value&&{description:value.description,uncertainties:value.uncertainties});
    if(value?.type!=="illustration_description"||!parsed.success)return <p role="alert">原图描述结果无效。</p>;
    return <section className="space-y-2"><h3 className="font-semibold">原图识别描述（未人工确认）</h3><p className="text-sm">可复制回AI设置的原图描述框，连同下方待核对项一起人工核对；不会自动调用生图。原图仅发给识图模型，MiniMax尚未收到这些内容。</p><textarea aria-label="取回的原图描述" readOnly className="w-full min-h-32 rounded border p-2 bg-background" value={parsed.data.description}/><h4>待核对项</h4><ul className="list-disc pl-5">{parsed.data.uncertainties.map((v,i)=><li key={i}>{v}</li>)}</ul>{!parsed.data.uncertainties.length&&<p>模型未报告不确定项，仍需人工核对。</p>}</section>;
}
export type IllustrationInitialDraft=Partial<IllustrationDraft> & {image?:string};
/** Local preview only. The server also validates actual image bytes before any vision call. */
export function safeIllustrationReference(image?:string):string{
    return image&&image.length<=8*1024*1024+64&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)?image:"";
}
type Props={initialDraft?:IllustrationInitialDraft;disabled:boolean;enabled:boolean;authorization:string;onBusy:(busy:boolean)=>void;onGenerate:(prompt:string,ratio:IllustrationRequest["ratio"])=>Promise<void>};
export function IllustrationComposer({initialDraft,disabled,enabled,authorization,onBusy,onGenerate}:Props){
    const [text,setText]=useState(initialDraft?.text||""),[description,setDescription]=useState(initialDraft?.description||""),[requirements,setRequirements]=useState(initialDraft?.requirements||""),[kind,setKind]=useState<IllustrationDraft["kind"]>(initialDraft?.kind||"geometry");
    const [image,setImage]=useState(()=>safeIllustrationReference(initialDraft?.image)),[uncertainties,setUncertainties]=useState<string[]>([]),[reviewed,setReviewed]=useState(false),[describeConsent,setDescribeConsent]=useState(false);
    const [version,setVersion]=useState(0),[composedVersion,setComposedVersion]=useState(-1),[prompt,setPrompt]=useState(""),[ratio,setRatio]=useState<IllustrationRequest["ratio"]>("1:1"),[consentStamp,setConsentStamp]=useState("");
    const [describing,setDescribing]=useState(false);
    const [previousAuthorization,setPreviousAuthorization]=useState(authorization);
    if(previousAuthorization!==authorization){setPreviousAuthorization(authorization);setConsentStamp("");setDescribeConsent(false);}
    const [message,setMessage]=useState(""),[job,setJob]=useState("");const pending=useRef(false),controller=useRef<AbortController|null>(null),file=useRef<HTMLInputElement>(null);
    useEffect(()=>()=>controller.current?.abort(),[]);
    const needsReview=!!image||!!description.trim();
    const sourceReady=!!(text.trim()||description.trim()||requirements.trim())&&(!image||!!description.trim())&&(!needsReview||reviewed);
    const stale=composedVersion!==version;
    const promptReady=sourceReady&&!stale&&!!prompt.trim()&&prompt.trim().length<=1500;
    const stamp=JSON.stringify([prompt,ratio,authorization,version]);
    const consent=!!consentStamp&&consentStamp===stamp;
    const invalidate=()=>{setVersion(v=>v+1);setConsentStamp("");setDescribeConsent(false);};
    function clearReference(){setImage("");setDescription("");setUncertainties([]);setReviewed(false);setJob("");setMessage("");invalidate();if(file.current)file.current.value="";}
    async function selectFile(selected?:File){
        if(!selected||pending.current||disabled)return;
        clearReference();
        if(!["image/png","image/jpeg","image/webp"].includes(selected.type)||selected.size>6*1024*1024||!selected.size){setMessage("只接受不超过6MiB的PNG/JPEG/WebP单张原图，服务器还会校验图像。旧描述已清空。");return;}
        pending.current=true;onBusy(true);
        try{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error());reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(Error());reader.readAsDataURL(selected)});setImage(data);setMessage("原图仅在本地预览，尚未发送。也可手动填写/粘贴已有识图描述，避免重复收费。");}catch{setMessage("读取图片失败，未发送AI。");}finally{pending.current=false;onBusy(false);}
    }
    async function describe(){
        if(pending.current||disabled||!image||!describeConsent)return;
        pending.current=true;onBusy(true);setDescribing(true);invalidate();setDescription("");setUncertainties([]);setReviewed(false);setJob("");setMessage("正在识别原图，只做描述，不解题、不自动生图。离开后可从我的AI任务取回。");
        const signal=new AbortController();controller.current=signal;
        try{
            const r=await apiClient.post<IllustrationDescriptionResult>("/api/ai/drawing/illustration_describe",{imageBase64:image,confirmDescription:true},{signal:signal.signal,onJobAccepted:setJob});
            const parsed=IllustrationDescriptionSchema.safeParse({description:r.description,uncertainties:r.uncertainties});
            if(r.type!=="illustration_description"||!parsed.success)throw new ApiError(422,"Invalid description",{message:"AI_DESCRIPTION_INVALID"});
            setDescription(parsed.data.description);setUncertainties(parsed.data.uncertainties);setMessage("识图完成，请对照原图修订描述并处理待核对项。尚未调用MiniMax。");
        }catch(e){setMessage(drawingFailureMessage(e instanceof ApiError?(e.data as {message?:string})?.message:undefined));}
        finally{controller.current=null;pending.current=false;onBusy(false);setDescribing(false);}
    }
    function compose(){if(disabled||!sourceReady)return;setPrompt(composeIllustrationPrompt({text,description,requirements,kind}));setComposedVersion(version);setConsentStamp("");}
    async function generate(){if(pending.current||disabled||!enabled||!promptReady||!consent)return;pending.current=true;setConsentStamp("");try{await onGenerate(prompt.trim(),ratio);}finally{pending.current=false;}}
    return <div className="space-y-3">
        <label className="block">原文/作图描述<textarea aria-label="原文或作图描述" className="w-full min-h-28 border rounded p-2 bg-background" maxLength={10000} value={text} disabled={disabled} onChange={e=>{setText(e.target.value);invalidate()}} placeholder="保留题干或原文中的明确条件。不要包含私人敏感信息。"/></label>
        <fieldset disabled={disabled} className="rounded border p-3 space-y-3"><legend className="px-1">可选：结合原图描述</legend>
            <p className="text-sm text-muted-foreground">上传不等于发送。识图使用AI设置中已保存的识图调用顺序，不使用MiniMax生图模型；单次派发，不自动换模型重试。可以粘贴已有描述并核对，不必重复识图。</p>
            <label className="block">参考原图（PNG/JPEG/WebP，≤6MiB）<input ref={file} aria-label="选择参考原图" className="block w-full min-w-0 rounded border bg-slate-50 p-2 text-sm dark:bg-slate-900" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void selectFile(e.target.files?.[0])}/></label>
            {image&&<><figure>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="待核对的参考原图，仅本地预览" className="max-w-full max-h-80 object-contain rounded border"/><figcaption className="text-xs">原图不直接发送给MiniMax，仅在单独确认后发送给识图模型。</figcaption></figure><Button variant="outline" onClick={clearReference}>移除原图</Button></>}
            <label className="flex gap-2 text-sm"><input aria-label="确认识图收费" type="checkbox" checked={describeConsent} disabled={disabled||!image} onChange={e=>setDescribeConsent(e.target.checked)}/>我同意将此原图发送给已保存的识图模型，可能收费；识图后不自动生图。</label>
            <Button variant="outline" disabled={disabled||!image||!describeConsent} onClick={()=>void describe()}>识别原图描述</Button>
            <label className="block">原图描述（可编辑，也可粘贴已有描述）<textarea aria-label="原图描述（可编辑）" className="w-full min-h-28 border rounded p-2 bg-background" maxLength={4000} value={description} onChange={e=>{setDescription(e.target.value);setReviewed(false);invalidate()}} placeholder="只写看清或已核对的对象、方向、尺寸与标注，不按外观猜测关系。"/></label>
            {!!uncertainties.length&&<div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950"><strong>待核对项（不自动作为生图条件）</strong><ul className="list-disc pl-5">{uncertainties.map((v,i)=><li key={i}>{v}</li>)}</ul><p>能够确认的内容补入上方描述，无法确认的不要补猜；修改原文与描述的冲突后再勾选。</p></div>}
            {needsReview&&<label className="flex gap-2 text-sm"><input aria-label="确认原图描述" type="checkbox" checked={reviewed} disabled={disabled||!description.trim()} onChange={e=>{setReviewed(e.target.checked);invalidate()}}/>我已对照原图核对描述并修正与原文的冲突，未确认项目不作为已知条件。</label>}
            <AIWorkProgress active={describing} label="原图识别"/>
            <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>{job&&<Link className="underline text-sm" href={`/ai-tasks?job=${encodeURIComponent(job)}`}>查看本次原图描述任务（可取消/取回）</Link>}
        </fieldset>
        <label className="block">补充作图要求<textarea aria-label="补充作图要求" className="w-full min-h-20 border rounded p-2 bg-background" maxLength={4000} value={requirements} disabled={disabled} onChange={e=>{setRequirements(e.target.value);invalidate()}} placeholder="例如：只画四分之一圆扇形，O为圆心，两条半径标4，不画完整圆或正方形。"/></label>
        <label className="block">提示词模板<select aria-label="配图提示词模板" className="border rounded p-2 ml-2 bg-background" value={kind} disabled={disabled} onChange={e=>{setKind(e.target.value as IllustrationDraft["kind"]);invalidate()}}><option value="geometry">几何/教学示意</option><option value="creative">一般创作配图</option></select></label>
        <p className="text-sm text-muted-foreground">模板只减少歧义，不能保证半径、角度和标签精确。严格几何请到题目编辑页使用几何辅助线：结构化底图→核对锁定→本地SVG绘制。</p>
        <Button variant="outline" disabled={disabled||!sourceReady} onClick={compose}>整理最终提示词（不调用AI）</Button>
        {composedVersion>=0&&<><label className="block">最终配图提示词（可继续编辑）<textarea aria-label="最终配图提示词" className="w-full min-h-48 rounded border p-2 bg-background" value={prompt} disabled={disabled} onChange={e=>{setPrompt(e.target.value);setConsentStamp("")}}/></label><p className="text-sm">{prompt.trim().length}/1500字。MiniMax只收到此处最终文字，不收到原图。</p>{stale&&<p role="alert">输入已变更，旧提示词已失效。请重新整理并核对；重新整理将替换当前提示词。</p>}{prompt.trim().length>1500&&<p role="alert">超过1500字，已禁止生成；不会自动截断条件。请自行精简最终提示词，保留关键关系和尺寸。</p>}</>}
        <label className="block">画幅<select aria-label="配图画幅" className="border rounded p-2 ml-2 bg-background" value={ratio} disabled={disabled} onChange={e=>{setRatio(e.target.value as IllustrationRequest["ratio"]);setConsentStamp("")}}>{["1:1","16:9","4:3","3:2","2:3","3:4","9:16"].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="flex gap-2 items-start text-sm"><input aria-label="确认配图收费" type="checkbox" checked={consent} disabled={disabled||!enabled||!promptReady} onChange={e=>setConsentStamp(e.target.checked?stamp:"")}/>我已核对最终提示词，同意将这段文字发送给MiniMax生成1张配图，可能收费；若状态不明先查看任务，不连续重发。</label>
        <Button disabled={disabled||!enabled||!promptReady||!consent} onClick={()=>void generate()}>生成1张配图</Button>
    </div>;
}
