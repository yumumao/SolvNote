"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {apiClient,ApiError} from "@/lib/api-client";
import {drawingFailureMessage} from "@/lib/ai-drawing/diagnostics";
import type {IllustrationRequest,IllustrationResult} from "@/lib/ai-drawing/illustration-schema";
import {IllustrationComposer} from "./illustration-composer";
import {Button} from "./ui/button";
import {AIWorkProgress} from "./ai-work-progress";
export type IllustrationSettingsView={revision:number;configRevision:number;providerId:string|null;model:IllustrationRequest["model"];enabled:boolean;providerName:string|null;providers:{id:string;name:string;baseUrl:string}[]};
type Settings=IllustrationSettingsView;
export function IllustrationPreview({result}:{result:unknown}){
    const [failed,setFailed]=useState(false);
    const r=result as Partial<IllustrationResult>|null;
    if(r?.type!=="illustration" || typeof r.imageDataUrl!=="string" || r.imageDataUrl.length>12*1024*1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.imageDataUrl))return <p role="alert">配图结果无效，未加载外部图片。</p>;
    return <figure className="space-y-2"><figcaption className="text-sm">AI创作配图 · {r.providerName} · {r.modelName}。仅作配图参考，文字和几何关系需人工核对，不替换原题图。</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.imageDataUrl} alt="AI创作配图，需人工核对" className="max-w-full max-h-[640px] object-contain rounded border" onError={()=>setFailed(true)} onLoad={()=>setFailed(false)}/>
        {failed && <p role="alert">图片显示失败，可尝试下载或从任务取回，不要重复提交收费请求。</p>}
        <a href={r.imageDataUrl} download="solvnote-illustration.png" className="underline">下载创作配图</a>
    </figure>;
}
export function IllustrationSettings(){
    const [settings,setSettings]=useState<Settings>(),[provider,setProvider]=useState(""),[model,setModel]=useState<IllustrationRequest["model"]>("image-01");
    const [authorizationEpoch,setAuthorizationEpoch]=useState(0);
    const resetConsent=()=>setAuthorizationEpoch(v=>v+1);
    const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[job,setJob]=useState(""),[result,setResult]=useState<IllustrationResult>();
    const pending=useRef(false);
    const [generating,setGenerating]=useState(false);
    const dirty=!!settings&&(provider!==(settings.providerId||"") || model!==settings.model);
    async function load(){if(pending.current)return;pending.current=true;setBusy(true);resetConsent();try{const s=await apiClient.get<Settings>("/api/ai/illustration-settings");setSettings(s);setProvider(s.providerId||"");setModel(s.model);setMessage("");}catch{setMessage("读取失败，请确认管理员身份后刷新。");}finally{pending.current=false;setBusy(false);}}
    async function save(){if(!settings||pending.current)return;if(provider&&!window.confirm("启用MiniMax创作配图，复用所选官方连接的Key。仅管理员可手动生成，可能收费；此授权不随ScanDex配置导出。确认？"))return;
        pending.current=true;setBusy(true);resetConsent();try{const s=await apiClient.post<Settings>("/api/ai/illustration-settings",{providerId:provider||null,model,revision:settings.revision,configRevision:settings.configRevision});setSettings(s);setMessage("已保存创作配图授权。不会改变文字/识图调用顺序。");}catch{setSettings(undefined);setMessage("保存未确认成功。请重新读取设置，检查连接与配置版本后再确认；未自动调用模型。");}finally{pending.current=false;setBusy(false);}}
    async function generate(prompt:string,ratio:IllustrationRequest["ratio"]){if(pending.current || !settings?.enabled || dirty || !prompt.trim() || prompt.trim().length>1500)return;
        pending.current=true;setBusy(true);setGenerating(true);resetConsent();setResult(undefined);setJob("");setMessage("正在生成；不会自动重试。离开页面后请到我的AI任务查看，勿重复提交。");
        try{const r=await apiClient.post<IllustrationResult>("/api/ai/drawing/illustration",{questionText:prompt.trim(),illustrationRatio:ratio,illustrationRevision:settings.revision,confirmIllustration:true},{onJobAccepted:setJob});setResult(r);setMessage("生成完成。结果保留24小时，请及时下载；不能将配图中的关系当作原题条件。");}
        catch(e){const data=e instanceof ApiError?e.data as {message?:string}:undefined;setMessage(drawingFailureMessage(data?.message));}
        finally{pending.current=false;setBusy(false);setGenerating(false);}
    }
    return <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">创作配图（MiniMax）</h3>
        <p className="text-sm text-muted-foreground">按原文或描述重新生成图片，无需Gemini。首版仅管理员使用，默认停用，每次生成1张且须确认收费。它不是原图编辑，也不能保证严格几何关系。</p>
        <p className="text-sm text-muted-foreground">先保存上方官方MiniMax连接（https://api.minimaxi.com、https://api.minimax.cn或https://api.minimax.io，可带/v1），不必添加假文字/识图模型。生图由专用协议调用；修改连接地址、Key、协议或本区模型后需重新确认。本站授权不随ScanDex文件导出。</p>
        <Button variant="outline" disabled={busy} onClick={()=>void load()}>读取/刷新创作配图设置</Button>
        {settings && <>
            <label className="block">配图连接<select aria-label="MiniMax配图连接" className="w-full border rounded p-2 bg-background" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);resetConsent()}}><option value="">停用</option>{provider&&!settings.providers.some(p=>p.id===provider)&&<option value={provider}>原连接已不可用，请重新选择</option>}{settings.providers.map(p=><option key={p.id} value={p.id}>{p.name} · {p.baseUrl}</option>)}</select></label>
            {!settings.providers.length && <p className="text-sm">尚无可用官方MiniMax连接，请在上方保存已启用且含Key的连接后刷新。请同时核对API基础地址是否在上述支持列表内；填写根地址或/v1，不要填写完整接口路径。</p>}
            <label className="block">配图模型<select aria-label="MiniMax配图模型" className="w-full border rounded p-2 bg-background" value={model} disabled={busy} onChange={e=>{setModel(e.target.value as IllustrationRequest["model"]);resetConsent()}}><option value="image-01">image-01</option><option value="image-01-live">image-01-live</option></select></label>
            <Button disabled={busy} onClick={()=>void save()}>保存创作配图设置</Button>
            <p className="text-sm">{dirty?"选择尚未保存，请先保存授权。":settings.enabled?`已启用：${settings.providerName} · ${settings.model}`:"当前未生效：尚未指定或连接配置已变更，请重新保存确认。"}</p>
            <IllustrationComposer disabled={busy} enabled={settings.enabled&&!dirty} authorization={JSON.stringify([settings.revision,settings.configRevision,provider,model,authorizationEpoch])} onBusy={setBusy} onGenerate={generate}/>
        </>}
        <AIWorkProgress active={generating} label="创作配图"/>
        <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>
        <div className="flex gap-4 text-sm">{job && <Link className="underline" href={`/ai-tasks?job=${encodeURIComponent(job)}`}>查看本次配图任务</Link>}<Link className="underline" href="/ai-tasks">我的AI任务/取回配图</Link></div>
        {result && <IllustrationPreview result={result}/>}
    </div>;
}
