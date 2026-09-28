"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {drawingFailureMessage} from "@/lib/ai-drawing/diagnostics";
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
export function DrawingResultPreview({result,originalImage,input}:{result:unknown;originalImage?:string|null;input?:unknown}){
    const r=result as DrawingResult;
    if(r?.type==="construction"){
        const plan=ConstructionSchema.safeParse(r.plan);if(!plan.success)return <p>构造格式无效，未执行。</p>;
        try{compileConstruction(plan.data);}catch{return <p>构造关系无效，未执行。</p>;}
        if(!plan.data.steps.length && input && typeof input==="object" && "questionText" in input && typeof input.questionText==="string"){
            const answerText="answerText" in input && typeof input.answerText==="string"?input.answerText:"";
            const analysis="analysis" in input && typeof input.analysis==="string"?input.analysis:"";
            const drawingCorrection="drawingCorrection" in input && typeof input.drawingCorrection==="string"?input.drawingCorrection:"";
            return <AuxiliaryDrawing questionText={input.questionText} answerText={answerText} analysis={analysis} drawingCorrection={drawingCorrection} image={originalImage} initialBase={plan.data}/>;
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
        <img src={r.imageDataUrl} alt="AI添加辅助线的派生示意图，需人工核对" onError={()=>setFailed(true)} onLoad={()=>setFailed(false)} className="max-w-full max-h-[640px] object-contain"/>
        {failed && <p role="alert">图片加载失败，但任务结果仍保留。可下载后检查，或到我的AI任务重新打开；不要重复提交收费绘图。</p>}
        <a className="underline" href={r.imageDataUrl} download="auxiliary-diagram.png">下载辅助线示意图</a>
    </div>;
}
export function AuxiliaryDrawing({questionText,answerText,analysis,drawingCorrection="",image,onUseCommands,disabled,initialBase}:{questionText:string;answerText:string;analysis:string;drawingCorrection?:string;image?:string|null;onUseCommands?:(commands:string)=>void;disabled?:boolean;initialBase?:ConstructionPlan}){
    const [correction,setCorrection]=useState(drawingCorrection);
    const source=JSON.stringify({questionText,image,drawingCorrection:correction}),solution=JSON.stringify({questionText,answerText,analysis,image});
    const [base,setBase]=useState<ConstructionPlan|undefined>(initialBase),[baseSource,setBaseSource]=useState(initialBase?source:""),[baseImage,setBaseImage]=useState(image);
    const [baseConfirmed,setBaseConfirmed]=useState(false),[plan,setPlan]=useState<ConstructionPlan>(),[planSource,setPlanSource]=useState("");
    const [settings,setSettings]=useState<EditorSettings>(),[confirmed,setConfirmed]=useState(false),[edited,setEdited]=useState<Extract<DrawingResult,{type:"image_edit"}>>();
    const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[jobId,setJobId]=useState("");
    const pending=useRef(false),baseStale=!!base && baseSource!==source,stale=!!plan && planSource!==solution;
    const usableBase=!!base&&!baseStale&&baseConfirmed;
    const shownPlan=plan&&!stale?plan:base;
    async function settingsLoad(){try{setSettings(await apiClient.get<EditorSettings>("/api/ai/drawing-settings"));}catch{setMessage("无法读取图片编辑设置，请刷新后重试。");}}
    async function generate(phase:"base"|"auxiliary"|"image_edit"){
        if(pending.current||disabled)return;
        if(phase==="auxiliary" && (!usableBase||!answerText.trim()))return;
        if(phase==="image_edit" && (!confirmed||!settings?.enabled||!plan||stale||baseStale||!image))return;
        const notice=phase==="base"?"第一步让AI只读取当前原题和原图，生成底图供你核对，不生成辅助线；答案与解析只保存用于后续步骤。可能产生费用，继续？":phase==="auxiliary"?"第二步发送已核对的固定底图和当前解答，只生成新增辅助步骤，不重建或改写原图。可能产生费用，继续？":"图片模型会生成整张派生图，不能保证原图像素或方向不变。这不是锁定底图模式，可能额外收费。继续？";
        if(!window.confirm(notice))return;
        pending.current=true;setBusy(true);setJobId("");setMessage("正在提交作图请求，尚未确认受理。请暂勿离开或重复点击；取得任务编号后才可到任务页取回。");
        try{
            const body=phase==="base"
                ? {questionText,answerText,analysis,drawingCorrection:correction,...(image?{imageBase64:image}:{})}
                : {questionText,answerText,analysis,...(image?{imageBase64:image}:{}),drawingPlan:phase==="auxiliary"?base:plan,...(phase==="image_edit"?{drawingRevision:settings!.revision,confirmImageEdit:true}:{})};
            const r=await apiClient.post<DrawingResult>(`/api/ai/drawing/${phase==="image_edit"?"image_edit":"construction"}`,body,{onJobAccepted:id=>{setJobId(id);setMessage("作图任务已受理，离开页面不会取消后台处理。可通过下方本次任务链接查看进度和取回图形；未保存草稿不会自动恢复。");}});
            if(r.type==="construction"){
                const parsed=ConstructionSchema.parse(r.plan);compileConstruction(parsed);
                if(phase==="base"){
                    if(parsed.steps.length)throw new Error("Unexpected source operations");
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
            setMessage(phase==="base"?"原题底图已生成。请先对照原图核对方向、点位及已有边，再勾选锁定并添加辅助线。此底图任务保留24小时，可到任务详情取回后继续，无需重新生成；取回图形不等于恢复当前编辑页或未保存草稿。":phase==="image_edit"?"AI整图编辑已完成。此派生图可能改变原图，请独立核对，不属于锁定底图模式。":"已完成。原题底图未被改写；任务结果保留24小时，可取回而无需重新生成。离开前请下载示意图，或保留全部步骤到题目并点击保存。");
        }catch(error){const data=error instanceof ApiError && error.data && typeof error.data==="object"?error.data:undefined;setMessage(drawingFailureMessage(data && "message" in data?data.message:undefined,data && "diagnostic" in data?data.diagnostic:undefined));}finally{pending.current=false;setBusy(false);}
    }
    return <section className="border rounded-lg p-4 space-y-3"><h3 className="font-semibold">几何辅助线（可选）</h3><p className="text-sm text-muted-foreground">分两次调用AI（均可能收费）：先重建原题底图，人工核对后锁定，再只添加辅助点和辅助线。浏览器免费绘制本地示意图，不是在原图像素上叠线；第二步不能修改、旋转或重新缩放底图。</p>
        <label className="block space-y-1"><span className="text-sm font-medium">原题底图纠正说明（可选）</span><textarea data-drawing-correction value={correction} onChange={e=>setCorrection(e.target.value)} maxLength={10000} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="例如：A应在左上角，AB是竖直边；不要把原图整体旋转。"/><span className="text-xs text-muted-foreground">这里只纠正原题图的方向、点位、标签和已有边；输入后必须重新生成并核对底图，不会直接当作解题步骤。</span></label>
        <Button variant="outline" disabled={disabled||busy||(!questionText.trim()&&!image)} onClick={()=>void generate("base")}>第一步：生成原题底图</Button>
        {base && <div className="space-y-2">{baseStale && <Button variant="outline" data-regenerate-base disabled={disabled||busy||(!questionText.trim()&&!image)} onClick={()=>void generate("base")}>根据纠正说明重新生成原题底图</Button>}<label className="flex gap-2"><input data-confirm-base type="checkbox" checked={baseConfirmed&&!baseStale} disabled={disabled||busy||baseStale} onChange={e=>setBaseConfirmed(e.target.checked)}/>我已核对原图方向、点位与已有边，锁定此底图</label><Button variant="outline" disabled={disabled||busy||!usableBase||!answerText.trim()} onClick={()=>void generate("auxiliary")}>第二步：在锁定底图上添加辅助线</Button></div>}
        {jobId && <p className="text-sm"><Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(jobId)}`}>查看/取回本次作图任务</Link>（可复制此链接，24小时内登录同一账号打开）</p>}
        {message && <p role="status" className="text-sm">{message} <Link className="underline" href="/ai-tasks">我的AI任务/调用记录</Link></p>}
        {baseStale && <p role="alert">原题、原图或底图纠正说明已修改，下面的底图属于旧版本。请先根据纠正说明重新生成并核对，不能套用旧底图。</p>}
        {stale&&!baseStale && <p role="alert">解答已修改，旧辅助步骤已隐藏，底图仍保持锁定。可根据新解答重新执行第二步。</p>}
        {shownPlan && <ConstructionPreview key={baseSource+(shownPlan===plan?planSource:"base")} plan={shownPlan} originalImage={baseImage} onUseCommands={!baseStale&&!stale&&!disabled&&!busy?onUseCommands:undefined}/>}
        <details onToggle={e=>{if(e.currentTarget.open)void settingsLoad();}}><summary className="cursor-pointer">实验性AI整图编辑（不保证底图不变）</summary><div className="space-y-3 mt-3">
            <p className="text-sm">此功能由图片模型重新输出整张派生图，不能保证原图像素、方向或标注不变，不属于上方的锁定底图模式。需要严格保留底图时，请使用上方本地分层示意图。仅接入Gemini协议图片输出模型。</p>
            <p>{settings?.enabled?`当前模型：${settings.modelName} · 所属连接：${settings.providerName}`:"未启用图片编辑，请管理员先在AI设置中选择支持图片输出的Gemini模型。"}</p>
            <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={!plan||stale||baseStale||busy} onChange={e=>setConfirmed(e.target.checked)}/>我已核对构造步骤，并知晓AI整图编辑可能改变原有图形</label>
            <Button variant="outline" disabled={disabled||busy||!settings?.enabled||!image||!plan||stale||baseStale||!confirmed} onClick={()=>void generate("image_edit")}>按构造指示生成辅助线图片</Button>
            {!image && <p className="text-sm">当前题目没有原图，不能使用原图编辑。</p>}
            {edited && <DrawingResultPreview result={edited}/>}
        </div></details>
    </section>;
}
