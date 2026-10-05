"use client";
import {DrawingEvidenceSchema,type DrawingEvidence} from "@/lib/ai-drawing/evidence";
import type {DrawingShareState} from "@/lib/solution-snapshot";
import {QuestionIllustration} from "./question-illustration";
import {IllustrationPreview} from "./illustration-settings";
import type {IllustrationResult} from "@/lib/ai-drawing/illustration-schema";
import {useEffect,useId,useRef,useState} from "react";
import {X} from "lucide-react";
import Link from "next/link";
import {drawingFailureMessage} from "@/lib/ai-drawing/diagnostics";
import {ApiError,apiClient} from "@/lib/api-client";
import {ConstructionSchema,compileConstruction,type ConstructionPlan} from "@/lib/ai-drawing/construction";
import {GeogebraDemo} from "./geogebra-demo";
import {ConstructionDiagram} from "./construction-diagram";
import {Button} from "./ui/button";
import {sameBaseDrawing} from "@/lib/ai-drawing/base-comparison";
import {AIWorkProgress} from "./ai-work-progress";
export type DrawingResult={type:"construction";plan:ConstructionPlan}|{type:"image_edit";imageDataUrl:string;modelName?:string;providerName?:string};
type EditorSettings={enabled:boolean;revision:number;modelName:string|null;providerName:string|null};
function OriginalImage({image}:{image?:string|null}){
    // Restored input is user supplied: never request arbitrary remote image URLs.
    if(typeof image!=="string" || image.length>12*1024*1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))return null;
    return <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">原题图对照（点击展开 / 收起）</summary><figure className="mt-3 space-y-1"><figcaption className="text-sm">原题图对照（只读）；下方为程序重建示意图，不是在原图片上叠线。</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="辅助线原题图对照" className="max-w-full max-h-[360px] object-contain object-left"/>
    </figure></details>;
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
export function DrawingResultPreview({result,originalImage,input}:{result:unknown;originalImage?:string|null;input?:unknown}){
    const r=result as DrawingResult|IllustrationResult;
    if(r?.type==="illustration")return <IllustrationPreview result={r}/>;
    if(r?.type==="construction"){
        const plan=ConstructionSchema.safeParse(r.plan);if(!plan.success)return <p>构造格式无效，未执行。</p>;
        try{compileConstruction(plan.data);}catch{return <p>构造关系无效，未执行。</p>;}
        if(!plan.data.steps.length && input && typeof input==="object" && "questionText" in input && typeof input.questionText==="string"){
            const answerText="answerText" in input && typeof input.answerText==="string"?input.answerText:"";
            const analysis="analysis" in input && typeof input.analysis==="string"?input.analysis:"";
            const drawingCorrection="drawingCorrection" in input && typeof input.drawingCorrection==="string"?input.drawingCorrection:"";
            const checked=DrawingEvidenceSchema.safeParse("drawingEvidence" in input?input.drawingEvidence:undefined);
            return <AuxiliaryDrawing drawingEvidence={checked.success?checked.data:undefined} questionText={input.questionText} answerText={answerText} analysis={analysis} drawingCorrection={drawingCorrection} image={originalImage} initialBase={plan.data}/>;
        }
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
    return <div className="space-y-2"><p>AI整图重绘，不能保证底图不变 · {r.modelName} · 所属连接：{r.providerName}。请核对新增线条和原有标注；此图不作为新题设。</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.imageDataUrl} alt="AI添加辅助线的派生示意图，需人工核对" onError={()=>setFailed(true)} onLoad={()=>setFailed(false)} className="max-w-full max-h-[640px] object-contain object-left"/>
        {failed && <p role="alert">图片加载失败，但任务结果仍保留。可下载后检查，或到我的AI任务重新打开；不要重复提交收费绘图。</p>}
        <a className="underline" href={r.imageDataUrl} download="auxiliary-diagram.png">下载辅助线示意图</a>
    </div>;
}
export function AuxiliaryDrawing({questionText,answerText,analysis,drawingCorrection="",drawingEvidence,image,onUseCommands,disabled,initialBase,onShareDrawings}:{questionText:string;answerText:string;analysis:string;drawingCorrection?:string;drawingEvidence?:DrawingEvidence;image?:string|null;onUseCommands?:(commands:string)=>void;disabled?:boolean;initialBase?:ConstructionPlan;onShareDrawings?:(state:DrawingShareState|null)=>void}){
    const [correction,setCorrection]=useState(drawingCorrection);
    const source=JSON.stringify({questionText,image,drawingCorrection:correction,drawingEvidence}),solution=JSON.stringify({questionText,answerText,analysis,image});
    const [base,setBase]=useState<ConstructionPlan|undefined>(initialBase),[baseSource,setBaseSource]=useState(initialBase?source:""),[baseImage,setBaseImage]=useState(image);
    const [baseConfirmed,setBaseConfirmed]=useState(false),[plan,setPlan]=useState<ConstructionPlan>(),[planSource,setPlanSource]=useState("");
    const [settings,setSettings]=useState<EditorSettings>(),[confirmed,setConfirmed]=useState(false),[edited,setEdited]=useState<Extract<DrawingResult,{type:"image_edit"}>>();
    const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[jobId,setJobId]=useState("");
    const [illustrating,setIllustrating]=useState(false);
    const [editingOpen,setEditingOpen]=useState(false);
    const editingDialog=useRef<HTMLDialogElement>(null),editingTitle=useId(),editingDescription=useId();
    // Native dialog hides, rather than unmounts, the composer. Closing must not abort
    // a paid request, discard drafts or restart it on the next open.
    useEffect(()=>{
        const dialog=editingDialog.current;if(!dialog)return;
        if(editingOpen&&!dialog.open)dialog.showModal();
        else if(!editingOpen&&dialog.open)dialog.close();
        if(!editingOpen)return;
        // A recovered base may live inside a Radix task-details dialog. Own Escape
        // before its document capture handler so it cannot unmount the outer task.
        const view=dialog.ownerDocument.defaultView;
        const escape=(event:KeyboardEvent)=>{
            if(event.key!=="Escape"||event.isComposing||!dialog.open||!(event.target instanceof Element)||event.target.closest("dialog")!==dialog)return;
            event.preventDefault();event.stopPropagation();setEditingOpen(false);
        };
        view?.addEventListener("keydown",escape,true);
        return ()=>view?.removeEventListener("keydown",escape,true);
    },[editingOpen]);
    const [progressLabel,setProgressLabel]=useState("作图");
    const [baseFeedbackAt,setBaseFeedbackAt]=useState<"initial"|"correction">("initial");
    const pending=useRef(false),baseStale=!!base && baseSource!==source,stale=!!plan && planSource!==solution;
    useEffect(()=>{onShareDrawings?.({questionText,answerText,analysis,image,basePlan:!baseStale?base:undefined,auxiliaryPlan:!baseStale&&!stale?plan:undefined})},[onShareDrawings,questionText,answerText,analysis,image,base,plan,baseStale,stale]);
    useEffect(()=>()=>onShareDrawings?.(null),[onShareDrawings]);
    const usableBase=!!base&&!baseStale&&baseConfirmed;
    async function settingsLoad(){try{setSettings(await apiClient.get<EditorSettings>("/api/ai/drawing-settings"));}catch{setMessage("无法读取图片编辑设置，请刷新后重试。");}}
    async function generate(phase:"base"|"auxiliary"|"image_edit",fromCorrection=false){
        if(pending.current||disabled||illustrating)return;
        if(phase==="auxiliary" && (!usableBase||!answerText.trim()))return;
        if(phase==="image_edit" && (!confirmed||!settings?.enabled||!plan||stale||baseStale||!image))return;
        const notice=phase==="base"?"第一步让AI只读取当前原题和原图，生成底图供你核对，不生成辅助线；答案与解析只保存用于后续步骤。可能产生费用，继续？":phase==="auxiliary"?"第二步发送已核对的固定底图和当前解答，只生成新增辅助步骤，不重建或改写原图。可能产生费用，继续？":"图片模型会生成整张派生图，不能保证原图像素或方向不变。这不是锁定底图模式，可能额外收费。继续？";
        if(!window.confirm(notice))return;
        if(phase==="base"){setBaseFeedbackAt(fromCorrection?"correction":"initial");setBaseConfirmed(false);}
        pending.current=true;setBusy(true);setProgressLabel(phase==="base"?"原题底图生成":phase==="auxiliary"?"辅助线方案生成":"整图编辑");setJobId("");setMessage("正在提交作图请求，尚未确认受理。请暂勿离开或重复点击；取得任务编号后才可到任务页取回。");
        try{
            const body=phase==="base"
                ? {questionText,answerText,analysis,drawingCorrection:correction,...(base?{drawingPreviousBase:base}:{}),...(drawingEvidence?{drawingEvidence}:{}),...(image?{imageBase64:image}:{})}
                : {questionText,answerText,analysis,...(image?{imageBase64:image}:{}),drawingPlan:phase==="auxiliary"?base:plan,...(phase==="image_edit"?{drawingRevision:settings!.revision,confirmImageEdit:true}:{})};
            const r=await apiClient.post<DrawingResult>(`/api/ai/drawing/${phase==="image_edit"?"image_edit":"construction"}`,body,{onJobAccepted:id=>{setJobId(id);setMessage("作图任务已受理，离开页面不会取消后台处理。可通过下方本次任务链接查看进度和取回图形；未保存草稿不会自动恢复。");}});
            let unchangedBase=false;
            if(r.type==="construction"){
                const parsed=ConstructionSchema.parse(r.plan);compileConstruction(parsed);
                if(phase==="base"){
                    if(parsed.steps.length)throw new Error("Unexpected source operations");
                    unchangedBase=!!base&&sameBaseDrawing(base,parsed);
                    setBase(parsed);setBaseSource(source);setBaseImage(image);setBaseConfirmed(false);setPlan(undefined);setPlanSource("");
                }else{
                    // Defense in depth: even a malformed successful HTTP response cannot replace the visible base.
                    if(!base||JSON.stringify({...parsed,steps:[]})!==JSON.stringify(ConstructionSchema.parse(base)))throw new Error("Source changed");
                    if(!parsed.steps.length)throw new Error("Missing auxiliary operations");
                    setPlan(parsed);setPlanSource(solution);
                }
                setConfirmed(false);setEdited(undefined);
            }else if(phase==="image_edit")setEdited(r);
            else throw new Error("Unexpected drawing result");
            setMessage(phase==="base"&&unchangedBase?"AI已返回本次重生成结果，但绘图内容与上一版相同（点位、连线和图内标记未变化）；标题或图注可能已更新，不代表底图已纠正。请核对后补充具体点位、方向或连接关系，再按需重新生成；不会自动重试收费。":phase==="base"?"原题底图已生成。请先对照原图核对方向、点位及已有边，再勾选锁定并添加辅助线。此底图任务保留24小时，可到任务详情取回后继续，无需重新生成；取回图形不等于恢复当前编辑页或未保存草稿。":phase==="image_edit"?"AI整图编辑已完成。此派生图可能改变原图，请独立核对，不属于锁定底图模式。":"已完成。原题底图未被改写；任务结果保留24小时，可取回而无需重新生成。离开前请下载示意图，或保留全部步骤到题目并点击保存。");
        }catch(error){const data=error instanceof ApiError && error.data && typeof error.data==="object"?error.data:undefined;setMessage(drawingFailureMessage(data && "message" in data?data.message:undefined,data && "diagnostic" in data?data.diagnostic:undefined));}finally{pending.current=false;setBusy(false);}
    }
    const workFeedback=<>
        {drawingEvidence && <p data-drawing-evidence className="text-sm text-muted-foreground">本次重绘复用当前识图题设与角标核对记录{drawingEvidence.authority==="verified"?"（独立AI核对，非人工确认）":drawingEvidence.authority.startsWith("user_")?"（人工修订/补充优先）":"（机器识读，仍需核对）"}；无法可靠定位的标记保留在图下注释。</p>}
        <AIWorkProgress active={busy&&(!editingOpen||progressLabel!=="整图编辑")} label={progressLabel}/>
        {jobId && <p className="text-sm"><Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(jobId)}`}>查看/取回本次作图任务</Link>（可复制此链接，24小时内登录同一账号打开）</p>}
        {message && <p role="status" className="text-sm">{message} <Link className="underline" href="/ai-tasks">我的AI任务/调用记录</Link></p>}
    </>;
    return <section className="border rounded-lg p-4 space-y-3"><h3 className="font-semibold">几何辅助线（可选）</h3><p className="text-sm text-muted-foreground">无需Gemini或生图API，复用现有文字/识图模型。分两次调用AI（均可能收费）：先重建原题底图，人工核对后锁定，再只添加辅助点和辅助线。浏览器免费绘制本地示意图，不是在原图像素上叠线；第二步不能修改、旋转或重新缩放底图。原图角号、数值等会尽量保留，复杂或待核对的标记见图下图注；请先核对标记与图注，再生成第二步。旧图需重新生成第一步才能补充此前未保存的标记。</p>
        <div data-drawing-stage="base" className="space-y-3">
            <Button variant="outline" disabled={disabled||busy||illustrating||(!questionText.trim()&&!image)} onClick={()=>void generate("base")}>第一步：生成原题底图</Button>
            {progressLabel==="原题底图生成" && baseFeedbackAt==="initial" && workFeedback}
            {baseStale && <p role="alert">原题、原图或底图纠正说明已修改，下面的底图属于旧版本。请先根据纠正说明重新生成并核对，不能套用旧底图。</p>}
            {base && <ConstructionPreview key={baseSource+"base"} plan={base} originalImage={baseImage} onUseCommands={!plan&&!baseStale&&!disabled&&!busy?onUseCommands:undefined}/>}
            <label className="block space-y-1"><span className="text-sm font-medium">原题底图纠正说明（可选）</span><textarea data-drawing-correction value={correction} onChange={e=>setCorrection(e.target.value)} maxLength={10000} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="例如：A应在左上角，AB是竖直边；不要把原图整体旋转。"/><span className="text-xs text-muted-foreground">这里只纠正原题图的方向、点位、标签和已有边；输入后必须重新生成并核对底图，不会直接当作解题步骤。</span></label>
            {base && (baseStale||correction.trim()||baseFeedbackAt==="correction") && <Button variant="outline" data-regenerate-base disabled={disabled||busy||illustrating||(!questionText.trim()&&!image)} onClick={()=>void generate("base",true)}>根据纠正说明重新生成原题底图</Button>}
            {progressLabel==="原题底图生成" && baseFeedbackAt==="correction" && workFeedback}
        </div>
        {base && <div data-drawing-stage="auxiliary" className="space-y-3 border-t pt-3">
            <label className="flex gap-2"><input data-confirm-base type="checkbox" checked={baseConfirmed&&!baseStale} disabled={disabled||busy||illustrating||baseStale} onChange={e=>setBaseConfirmed(e.target.checked)}/>我已核对原图方向、点位与已有边，锁定此底图</label>
            <Button variant="outline" disabled={disabled||busy||illustrating||!usableBase||!answerText.trim()} onClick={()=>void generate("auxiliary")}>第二步：在锁定底图上添加辅助线</Button>
            {progressLabel==="辅助线方案生成" && workFeedback}
            {stale&&!baseStale && <p role="alert">解答已修改，旧辅助步骤已隐藏，底图仍保持锁定。可根据新解答重新执行第二步。</p>}
            {plan&&!stale && <ConstructionPreview key={baseSource+planSource} plan={plan} originalImage={baseImage} onUseCommands={!baseStale&&!disabled&&!busy?onUseCommands:undefined}/>}
        </div>}
        {progressLabel!=="原题底图生成"&&progressLabel!=="辅助线方案生成" && workFeedback}
        <Button type="button" variant="outline" aria-haspopup="dialog" onClick={()=>{setEditingOpen(true);void settingsLoad();}}>打开实验性AI重新配图 / 整图编辑</Button>
        <dialog ref={editingDialog} aria-labelledby={editingTitle} aria-describedby={editingDescription} onCancel={e=>{e.preventDefault();setEditingOpen(false);}} onClose={()=>setEditingOpen(false)} className="fixed inset-0 m-auto hidden h-[90dvh] max-h-[900px] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60 open:flex">
            <header className="relative shrink-0 border-b p-4 pr-16 sm:p-6 sm:pr-16">
                <h3 id={editingTitle} className="font-semibold text-lg">实验性AI重新配图 / 整图编辑</h3>
                <p id={editingDescription} className="mt-1 text-sm text-muted-foreground">不保证底图不变。关闭弹窗不会取消任务，本页草稿和结果会保留；离开或刷新页面不保留未保存草稿。</p>
                <button type="button" onClick={()=>setEditingOpen(false)} className="absolute right-4 top-4 z-20 inline-flex size-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 shadow-sm transition-colors hover:bg-red-200 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2">
                    <X className="h-4 w-4" aria-hidden="true"/><span className="sr-only">关闭弹窗</span>
                </button>
            </header>
            <div data-drawing-dialog-scroll className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <QuestionIllustration questionText={questionText} image={image} requirements={correction.trim()?`原题图纠正说明（不是新增题设）：${correction}`:""} disabled={!!disabled||busy} onBusyChange={setIllustrating}/>
            <h4 className="font-semibold border-t pt-3">Gemini原图编辑</h4>
            <p className="text-sm">此功能由图片模型重新输出整张派生图，不能保证原图像素、方向或标注不变，不属于上方的锁定底图模式。需要严格保留底图时，请使用上方本地分层示意图。本分区仅接入Gemini协议图片输出模型；没有Gemini时可用上方MiniMax重新配图。</p>
            <p>{settings?.enabled?`当前模型：${settings.modelName} · 所属连接：${settings.providerName}`:"未启用图片编辑，请管理员先在AI设置中选择支持图片输出的Gemini模型。"}</p>
            <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={disabled||!plan||stale||baseStale||busy||illustrating} onChange={e=>setConfirmed(e.target.checked)}/>我已核对构造步骤，并知晓AI整图编辑可能改变原有图形</label>
            <Button variant="outline" disabled={disabled||busy||illustrating||!settings?.enabled||!image||!plan||stale||baseStale||!confirmed} onClick={()=>void generate("image_edit")}>按构造指示生成辅助线图片</Button>
            {!image && <p className="text-sm">当前题目没有原图，不能使用原图编辑。</p>}
            <AIWorkProgress active={busy&&editingOpen&&progressLabel==="整图编辑"} label={progressLabel}/>
            {progressLabel==="整图编辑" && jobId && <p className="text-sm"><Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(jobId)}`}>查看/取回本次作图任务</Link></p>}
            {progressLabel==="整图编辑" && message && <p role="status" className="text-sm">{message}</p>}
            {edited && <DrawingResultPreview result={edited}/>}
        </div></dialog>
    </section>;
}
