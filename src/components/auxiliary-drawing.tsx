"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {diagnosticMessage} from "@/lib/ai/diagnostics";
import {ApiError,apiClient} from "@/lib/api-client";
import {ConstructionSchema,compileConstruction,type ConstructionPlan} from "@/lib/ai-drawing/construction";
import {GeogebraDemo} from "./geogebra-demo";
import {ConstructionDiagram} from "./construction-diagram";
import {Button} from "./ui/button";
export type DrawingResult={type:"construction";plan:ConstructionPlan}|{type:"image_edit";imageDataUrl:string;modelName?:string;providerName?:string};
type EditorSettings={enabled:boolean;revision:number;modelName:string|null;providerName:string|null};
function OriginalImage({image}:{image?:string|null}){
    // Restored input is user supplied: never request arbitrary remote image URLs.
    if(typeof image!=="string" || image.length>12*1024*1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))return null;
    return <figure className="space-y-1"><figcaption className="text-sm">原题图对照（只读）；下方为程序重建示意图，不是在原图片上叠线。</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="辅助线原题图对照" className="max-w-full max-h-[360px] object-contain"/>
    </figure>;
}
export function ConstructionPreview({plan,onUseCommands,originalImage}:{plan:ConstructionPlan;onUseCommands?:(commands:string)=>void;originalImage?:string|null}){
    const [count,setCount]=useState(plan.steps.length),[dynamic,setDynamic]=useState(false);
    const compiled=compileConstruction(plan),visible=Math.min(count,compiled.steps.length),commands=JSON.stringify([...compiled.base,...compiled.steps.slice(0,visible).flatMap(s=>s.commands)]);
    return <div className="space-y-3"><h4 className="font-semibold">{plan.title}</h4><p className="text-sm">坐标是示意。程序只保证列出的构造操作，不代表AI已证明题设、解答或底图坐标正确。</p>
        <ol className="list-decimal pl-6">{compiled.steps.map((s,i)=><li key={i} className={i>=visible?"text-muted-foreground":""}>{s.description}</li>)}</ol>
        <div className="flex gap-2 items-center"><Button variant="outline" disabled={!visible} onClick={()=>setCount(visible-1)}>上一步</Button><span>{visible}/{compiled.steps.length}步</span><Button variant="outline" disabled={visible===compiled.steps.length} onClick={()=>setCount(visible+1)}>下一步</Button></div>
        <OriginalImage image={originalImage}/>
        <ConstructionDiagram geometry={compiled.geometry} visible={visible} title={plan.title}/>
        <Button variant="outline" onClick={()=>setDynamic(v=>!v)}>{dynamic?"关闭GeoGebra动态演示":"打开GeoGebra动态演示（需联网）"}</Button>
        {dynamic && <GeogebraDemo commands={commands}/> }
        {onUseCommands && <Button variant="outline" onClick={()=>onUseCommands(JSON.stringify([...compiled.base,...compiled.steps.flatMap(s=>s.commands)]))}>保留全部步骤到当前题目</Button>}
    </div>;
}
export function DrawingResultPreview({result,originalImage}:{result:unknown;originalImage?:string|null}){
    const r=result as DrawingResult;
    if(r?.type==="construction"){
        const plan=ConstructionSchema.safeParse(r.plan);if(!plan.success)return <p>构造格式无效，未执行。</p>;
        try{compileConstruction(plan.data);}catch{return <p>构造关系无效，未执行。</p>;}
        return <ConstructionPreview plan={plan.data} originalImage={originalImage}/>;
    }
    if(r?.type==="image_edit"){
        if(typeof r.imageDataUrl!=="string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.imageDataUrl))return <p role="alert">作图任务未包含有效图片，请查看调用记录；不会自动重新提交。</p>;
        return <EditedImagePreview key={r.imageDataUrl} result={r}/>;
    }
    return <p>暂无可预览的作图结果。</p>;
}
function EditedImagePreview({result:r}:{result:Extract<DrawingResult,{type:"image_edit"}>}){
    const [failed,setFailed]=useState(false);
    return <div className="space-y-2"><p>AI改图示意 · {r.modelName} · 所属连接：{r.providerName}。请核对新增线条和原有标注；此图不作为新题设。</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.imageDataUrl} alt="AI添加辅助线的派生示意图，需人工核对" onError={()=>setFailed(true)} onLoad={()=>setFailed(false)} className="max-w-full max-h-[640px] object-contain"/>
        {failed && <p role="alert">图片加载失败，但任务结果仍保留。可下载后检查，或到我的AI任务重新打开；不要重复提交收费绘图。</p>}
        <a className="underline" href={r.imageDataUrl} download="auxiliary-diagram.png">下载辅助线示意图</a>
    </div>;
}
export function AuxiliaryDrawing({questionText,answerText,analysis,image,disabled=false,onUseCommands}:{questionText:string;answerText:string;analysis:string;image?:string|null;disabled?:boolean;onUseCommands?:(commands:string)=>void}){
    const [plan,setPlan]=useState<ConstructionPlan>(),[planSource,setPlanSource]=useState(""),[planImage,setPlanImage]=useState<string|null>(),[edited,setEdited]=useState<DrawingResult>(),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[settings,setSettings]=useState<EditorSettings>(),[confirmed,setConfirmed]=useState(false),[jobId,setJobId]=useState("");
    const pending=useRef(false),source=JSON.stringify({questionText,answerText,analysis,image});
    const stale=!!plan && planSource!==source;
    async function settingsLoad(){try{setSettings(await apiClient.get<EditorSettings>("/api/ai/drawing-settings"));}catch{setMessage("无法读取图片编辑设置，请刷新后重试。");}}
    async function generate(kind:"construction"|"image_edit"){
        if(pending.current||disabled)return;
        if(kind==="image_edit" && (!confirmed||!settings?.enabled||!plan||stale||!image))return;
        if(!window.confirm(kind==="construction"?"将当前编辑的题目、答案、解析和原图（若有）提交给解题模型生成构造方案，可能产生费用。继续？":"将原图和已核对的构造指示发送给指定图片编辑模型，可能产生额外费用。只生成派生图，不覆盖原图。继续？"))return;
        pending.current=true;setBusy(true);setJobId("");setMessage("正在提交作图请求，尚未确认受理。请暂勿离开或重复点击；取得任务编号后才可到任务页取回。");
        try{
            const r=await apiClient.post<DrawingResult>(`/api/ai/drawing/${kind}`,{questionText,answerText,analysis,...(image?{imageBase64:image}:{}),...(kind==="image_edit"?{drawingPlan:plan,drawingRevision:settings!.revision,confirmImageEdit:true}:{})},{onJobAccepted:id=>{setJobId(id);setMessage("作图任务已受理，离开页面不会取消后台处理。可通过下方本次任务链接查看进度和取回图形；未保存的编辑草稿与当前步骤不会自动恢复。");}});
            if(r.type==="construction"){compileConstruction(r.plan);setPlan(r.plan);setPlanSource(source);setPlanImage(image);setConfirmed(false);setEdited(undefined);}else setEdited(r);
            setMessage("已完成。两种作图任务结果均保留24小时，可到本次任务取回，无需重新生成。取回图形不等于恢复当前编辑页、未保存草稿或当前步骤；离开前请下载示意图，或保留全部步骤到题目并点击保存。");
        }catch(error){const code=error instanceof ApiError && error.data && typeof error.data==="object" && "message" in error.data?error.data.message:undefined;setMessage(code==="AI_DRAWING_UNSUPPORTED"?diagnosticMessage("DRAWING_UNSUPPORTED")!:"作图未确认完成。请到我的AI任务核对错误与调用记录，不要连续重发；图片编辑需管理员指定受支持模型，设置变化后需重新确认。");}finally{pending.current=false;setBusy(false);}
    }
    return <section className="border rounded-lg p-4 space-y-3"><h3 className="font-semibold">几何辅助线（可选）</h3><p className="text-sm text-muted-foreground">先调用解题AI生成底图与辅助线方案（可能收费），再由浏览器免费绘制本地示意图；并非完全不用AI，也不是原图叠线。GeoGebra动态演示按需打开，不改动题干与原图。</p>
        <Button variant="outline" disabled={disabled||busy||!questionText.trim()||!answerText.trim()} onClick={()=>void generate("construction")}>生成分步辅助线方案</Button>
        {jobId && <p className="text-sm"><Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(jobId)}`}>查看/取回本次作图任务</Link>（可复制此链接，24小时内登录同一账号打开）</p>}
        {message && <p role="status" className="text-sm">{message} <Link className="underline" href="/ai-tasks">我的AI任务/调用记录</Link></p>}
        {stale && <p role="alert">题目或解答已修改，下面是旧版本构造；请重新生成，不能把旧方案应用到新题设。</p>}
        {plan && <ConstructionPreview key={planSource} plan={plan} originalImage={planImage} onUseCommands={!stale&&!disabled&&!busy?onUseCommands:undefined}/>}
        <details onToggle={e=>{if(e.currentTarget.open)void settingsLoad();}}><summary className="cursor-pointer">可选：让支持图片编辑的AI在原图上添加辅助线</summary><div className="space-y-3 mt-3">
            <p className="text-sm">多模态识图不等于图片编辑。首版仅接入Gemini协议的图片输出模型，由管理员单独指定；生成图可能画错，不用于自动验证解题。</p>
            <p>{settings?.enabled?`当前模型：${settings.modelName} · 所属连接：${settings.providerName}`:"未启用图片编辑，请管理员先在AI设置中选择支持图片输出的Gemini模型。"}</p>
            <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={!plan||stale||busy} onChange={e=>setConfirmed(e.target.checked)}/>我已核对上面的构造步骤，将按此指示添加辅助线</label>
            <Button variant="outline" disabled={disabled||busy||!settings?.enabled||!image||!plan||stale||!confirmed} onClick={()=>void generate("image_edit")}>按构造指示生成辅助线图片</Button>
            {!image && <p className="text-sm">当前题目没有原图，不能使用原图编辑。</p>}
            {edited && <DrawingResultPreview result={edited}/>}
        </div></details>
    </section>;
}
