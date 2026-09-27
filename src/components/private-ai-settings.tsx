"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import type {AIModel,AIProvider,PortableConfig} from "@/lib/ai-config/schema";
type SafeProvider=Omit<AIProvider,"apiKey"> & {hasKey:boolean};
type DraftProvider=SafeProvider & {newKey:string;clearKey:boolean};
type Summary={id:string;name:string;providerName:string};
type Snapshot={revision:number;config:Omit<PortableConfig,"providers"> & {providers:SafeProvider[]};siteModels?:Summary[]};
const empty:PortableConfig={version:1,providers:[],models:[],chains:{text:[],vision:[]}};
const css="rounded border px-3 py-2 bg-background text-foreground";
const message=(status:number)=>status===409?"配置已被修改，请重新加载后再编辑。":status===401||status===403?"登录或权限已失效，请重新登录。":status===429?"操作过于频繁，请稍后重试。":"操作未完成，请检查格式、连接地址与模型设置。";
export function PrivateAISettings(){
 const [revision,setRevision]=useState(0),[providers,setProviders]=useState<DraftProvider[]>([]),[models,setModels]=useState<AIModel[]>([]),[chains,setChains]=useState(empty.chains),[site,setSite]=useState<Summary[]>([]);
 const [busy,setBusy]=useState(true),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState("");
 const [importText,setImportText]=useState(""),[format,setFormat]=useState("portable"),[mode,setMode]=useState("merge"),[password,setPassword]=useState("");
 const accept=useCallback((data:Snapshot)=>{setRevision(data.revision);setProviders(data.config.providers.map(p=>({...p,newKey:"",clearKey:false})));setModels(data.config.models);setChains(data.config.chains);if(data.siteModels)setSite(data.siteModels);setLoaded(true);},[]);
 const load=useCallback(async()=>{setBusy(true);try{const r=await fetch("/api/user/ai-config",{cache:"no-store"});if(!r.ok){setNotice(message(r.status));return;}accept(await r.json());setNotice("");}catch{setNotice("无法加载配置，请稍后重试。");}finally{setBusy(false);}},[accept]);
 useEffect(()=>{void load();},[load]); // Keys are never placed in local/session storage or URLs.
 function payload():PortableConfig{
  const ps=providers.map(({hasKey,newKey,clearKey,...p})=>({...p,apiKey:clearKey?"":newKey||(hasKey?"********":"")}));
  const valid=(kind:"text"|"vision")=>models.filter(m=>m.enabled && m.capabilities.includes(kind) && ps.some(p=>p.id===m.providerId && p.enabled)).map(m=>m.id);
  const order=(kind:"text"|"vision")=>[...new Set([...chains[kind],...valid(kind)])].filter(id=>valid(kind).includes(id));
  return {version:1,providers:ps,models,chains:{text:order("text"),vision:order("vision")}};
 }
 async function mutate(importing=false){setBusy(true);setNotice("");try{
  const body=importing?{revision,mode,format,...(format==="encrypted"?{envelope:JSON.parse(importText),password}:{config:JSON.parse(importText)})}:{revision,config:payload()};
  const r=await fetch(importing?"/api/user/ai-config/import":"/api/user/ai-config",{method:importing?"POST":"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok){setNotice(message(r.status));return;}accept(await r.json());setPassword("");setImportText("");setNotice("已保存。站点授权不受私有配置修改影响。");
 }catch{setNotice("无法保存，请检查JSON格式并重试。");}finally{setBusy(false);}}
 function provider(id:string,patch:Partial<DraftProvider>){setProviders(ps=>ps.map(p=>p.id===id?{...p,...patch}:p));}
 function model(id:string,patch:Partial<AIModel>){setModels(ms=>ms.map(m=>m.id===id?{...m,...patch}:m));}
 return <main className="mx-auto max-w-4xl space-y-6 p-6">
  <h1 className="text-2xl font-bold">我的AI设置</h1>
  <p>站点模型由管理员授权。私有连接仅本人可用；已保存的密钥不会返回浏览器，不提供导出。</p>
  <Link href="/">返回首页</Link>
  {notice&&<p role="status" className="rounded border p-3">{notice}</p>}
  <button className={css} type="button" disabled={busy} onClick={()=>void load()}>重新加载</button>
  <section><h2 className="text-lg font-semibold">已授权站点模型</h2>{site.length?<ul>{site.map(m=><li key={m.id}>{m.name} · {m.providerName}</li>)}</ul>:<p>暂无站点授权；仍可添加自己的私有AI。</p>}</section>
  <fieldset disabled={busy||!loaded} className="space-y-4">
   <legend className="text-lg font-semibold">私有连接（最多10个）</legend>
   {providers.map(p=><section key={p.id} className="space-y-3 rounded border p-4">
    <label className="block">连接名称 <input className={css} value={p.name} maxLength={100} onChange={e=>provider(p.id,{name:e.target.value})}/></label>
    <label className="block">协议 <select className={css} value={p.protocol} onChange={e=>provider(p.id,{protocol:e.target.value as AIProvider["protocol"]})}>{["chat","responses","responses_codex","gemini","azure"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="block">HTTPS连接地址 <input className={css+" w-full"} type="url" value={p.baseUrl} maxLength={2048} onChange={e=>provider(p.id,{baseUrl:e.target.value})}/></label>
    {p.protocol==="azure"&&<label className="block">API版本 <input className={css} value={p.apiVersion||""} onChange={e=>provider(p.id,{apiVersion:e.target.value})}/></label>}
    <label className="block">密钥 <input className={css} type="password" autoComplete="new-password" value={p.newKey} placeholder={p.hasKey?"已保存；留空保留原密钥":"输入自己的密钥"} maxLength={16384} onChange={e=>provider(p.id,{newKey:e.target.value,clearKey:false})}/></label>
    <p className="text-sm">更换地址或协议后必须输入新密钥。请求可能消耗此连接的额度。</p>
    <label><input type="checkbox" checked={p.clearKey} onChange={e=>provider(p.id,{clearKey:e.target.checked,newKey:""})}/>清空已保存密钥</label>{" "}
    <label><input type="checkbox" checked={p.enabled} onChange={e=>provider(p.id,{enabled:e.target.checked})}/>启用连接</label>{" "}
    <button type="button" className={css} onClick={()=>{setProviders(ps=>ps.filter(x=>x.id!==p.id));setModels(ms=>ms.filter(m=>m.providerId!==p.id));}}>删除连接</button>
    {models.filter(m=>m.providerId===p.id).map(m=><div key={m.id} className="space-y-2 border-t pt-3">
     <label className="block">模型名称 <input className={css} value={m.name} maxLength={200} onChange={e=>model(m.id,{name:e.target.value})}/></label>
     <label className="block">上游模型ID <input className={css} value={m.model} maxLength={200} onChange={e=>model(m.id,{model:e.target.value})}/></label>
     {(["text","vision"] as const).map(cap=><label key={cap} className="mr-4"><input type="checkbox" checked={m.capabilities.includes(cap)} onChange={e=>model(m.id,{capabilities:e.target.checked?[...m.capabilities,cap]:m.capabilities.filter(c=>c!==cap)})}/>{cap==="text"?"文本":"读图"}</label>)}
     <label><input type="checkbox" checked={m.enabled} onChange={e=>model(m.id,{enabled:e.target.checked})}/>启用模型</label>{" "}
     <button className={css} type="button" onClick={()=>setModels(ms=>ms.filter(x=>x.id!==m.id))}>删除模型</button>
    </div>)}
    <button className={css} type="button" disabled={models.length>=30} onClick={()=>setModels(ms=>[...ms,{id:crypto.randomUUID(),providerId:p.id,name:"新模型",model:"",capabilities:["text"],enabled:true}])}>添加模型</button>
   </section>)}
   <button className={css} type="button" disabled={providers.length>=10} onClick={()=>setProviders(ps=>[...ps,{id:crypto.randomUUID(),name:"私有连接",protocol:"chat",baseUrl:"",enabled:true,hasKey:false,newKey:"",clearKey:false}])}>添加私有连接</button>{" "}
   <button className={css} type="button" onClick={()=>void mutate()}>保存私有AI</button>
  </fieldset>
  <fieldset disabled={busy||!loaded} className="space-y-3 rounded border p-4"><legend>导入自己的配置</legend>
   <p>仅导入本地JSON文件。合并覆盖相同ID，替换会移除现有私有配置；不会修改站点配置。</p>
   <a href="/api/ai/config/template" download>下载空白导入模板</a>
   <label className="block">本地JSON文件 <input type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>1024*1024){setNotice("文件过大（最多1MiB）。");return;}try{const text=await f.text();const obj=JSON.parse(text);setImportText(text);setFormat(Array.isArray(obj.providers)?"portable":"encrypted");}catch{setNotice("无法读取JSON文件。");}finally{e.target.value="";}}}/></label>
   <label>导入格式 <select className={css} value={format} onChange={e=>setFormat(e.target.value)}><option value="portable">明文模板</option><option value="encrypted">加密配置</option></select></label>{" "}
   <label>导入方式 <select className={css} value={mode} onChange={e=>setMode(e.target.value)}><option value="merge">合并</option><option value="replace">替换全部私有配置</option></select></label>
   {format==="encrypted"&&<label className="block">解密口令 <input className={css} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024}/></label>}
   <button className={css} disabled={!importText||(format==="encrypted"&&password.length<12)} onClick={()=>void mutate(true)}>确认导入私有配置</button>
  </fieldset>
 </main>;
}
