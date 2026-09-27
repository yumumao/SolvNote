"use client";
import {useCallback,useEffect,useState} from "react";
type Model={id:string;name:string;providerName:string;isAllowed:boolean;defaultRank:number|null};
type Policy={revision:number;models:Model[];defaultModelIds:string[]};
type Grants={revision:number;userId:string;models:Model[];grants:{modelId:string;source:string}[]};
const css="rounded border px-3 py-2 bg-background text-foreground";
/** Standalone: MAIN mounts this in admin/ai. Passing userId opens that account's full snapshot. */
export function AIAccessPanel({userId}:{userId?:string}={}){
 const [policy,setPolicy]=useState<Policy|null>(null),[defaults,setDefaults]=useState<string[]>([]),[allowed,setAllowed]=useState<string[]>([]),[target,setTarget]=useState(userId||""),[grants,setGrants]=useState<Grants|null>(null),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const error=useCallback((status:number)=>status===409?"权限配置已被修改，请重新加载。":status===401||status===403?"管理员权限已失效。":"操作失败，请检查默认数量、模型状态和用户ID。",[]);
 const call=useCallback(async<T,>(url:string,body?:unknown):Promise<T>=>{const r=await fetch(url,{cache:"no-store",...(body?{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(error(r.status));return r.json();},[error]);
 const accept=useCallback(function accept(p:Policy){setPolicy(p);setDefaults(p.defaultModelIds);setAllowed(p.models.filter(m=>m.isAllowed).map(m=>m.id));},[]);
 const load=useCallback(async()=>{setBusy(true);try{accept(await call<Policy>("/api/admin/ai/access"));setNotice("");}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}},[accept,call]);
 useEffect(()=>{void load();},[load]);
 const loadUser=useCallback(async(id:string)=>{if(!id.trim())return;setBusy(true);try{const data=await call<Grants>(`/api/admin/ai/access/users/${encodeURIComponent(id)}`);setGrants(data);setSelected(data.grants.filter(g=>data.models.some(m=>m.id===g.modelId&&m.isAllowed)).map(g=>g.modelId));setNotice("");}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}},[call]);
 useEffect(()=>{if(userId){setTarget(userId);void loadUser(userId);}},[userId,loadUser]);
 async function save(user=false){setBusy(true);try{if(user&&grants){const data=await call<Grants>(`/api/admin/ai/access/users/${encodeURIComponent(grants.userId)}`,{revision:grants.revision,modelIds:selected});setGrants(data);if(policy)setPolicy({...policy,revision:data.revision});}else{accept(await call<Policy>("/api/admin/ai/access",{revision:policy!.revision,defaultModelIds:defaults,allowedModelIds:allowed}));setGrants(null);}setNotice("权限已保存。默认项变更只影响以后创建的用户；撤权立即影响后续调用和结果读取。");}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
 const toggle=(ids:string[],id:string,checked:boolean)=>checked?[...ids,id]:ids.filter(x=>x!==id);
 return <section className="space-y-4 rounded border p-4"><h2 className="text-xl font-semibold">站点AI授权</h2>
  <p>默认模型需选择{Math.min(3,allowed.length)}项。新用户快照默认项，旧用户不会随默认项变更而改写。</p>
  {notice&&<p role="status">{notice}</p>}
  <button className={css} disabled={busy} onClick={()=>void load()}>重新加载权限</button>
  <fieldset disabled={busy||!policy} className="space-y-2"><legend>站点模型与新用户默认项</legend>
   {policy?.models.map(m=><div key={m.id} className="flex flex-wrap gap-4"><span>{m.name} · {m.providerName}</span>
    <label><input type="checkbox" checked={allowed.includes(m.id)} onChange={e=>{setAllowed(toggle(allowed,m.id,e.target.checked));if(!e.target.checked)setDefaults(defaults.filter(id=>id!==m.id));}}/>允许授权</label>
    <label><input type="checkbox" disabled={!allowed.includes(m.id)||(!defaults.includes(m.id)&&defaults.length>=3)} checked={defaults.includes(m.id)} onChange={e=>setDefaults(toggle(defaults,m.id,e.target.checked))}/>新用户默认{defaults.includes(m.id)?`（${defaults.indexOf(m.id)+1}）`:""}</label>
   </div>)}
   <button className={css} disabled={defaults.length!==Math.min(3,allowed.length)} onClick={()=>void save()}>保存站点权限</button>
  </fieldset>
  <fieldset disabled={busy||!policy} className="space-y-3 border-t pt-4"><legend>指定用户完整授权快照</legend>
   <p>可增加或撤回此用户的站点模型。保存会替换其完整快照并使旧登录会话失效，不影响其私有AI。</p>
   <label>用户ID <input className={css} value={target} onChange={e=>{setTarget(e.target.value);setGrants(null);}}/></label>{" "}
   <button className={css} onClick={()=>void loadUser(target)}>加载用户授权</button>
   {grants&&<><p>当前用户：{grants.userId}</p>{grants.models.filter(m=>m.isAllowed).map(m=><label className="block" key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={e=>setSelected(toggle(selected,m.id,e.target.checked))}/>{m.name} · {m.providerName}</label>)}<button className={css} onClick={()=>void save(true)}>保存用户授权</button></>}
  </fieldset>
 </section>;
}
export default AIAccessPanel;
