"use client";
import { useCallback, useEffect, useState } from "react";
import { AIModelOrderEditor, type OrderModel } from "./ai-model-order-editor";
import type { ModelOrder } from "@/lib/ai-access/model-order";
type Snapshot={models:OrderModel[];chains:ModelOrder;revisions:{site:number;policy:number;private:number;order:number}};
const message=(status:number)=>status===409?"模型或顺序已被修改，请重新加载顺序后再保存。":status===401||status===403?"登录或授权已失效，请重新登录。":"顺序保存失败，请重新加载后重试。";
export function AIModelOrderSettings({refreshKey}:{refreshKey:number}){
    const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[chains,setChains]=useState<ModelOrder>({text:[],vision:[]}),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
    const load=useCallback(async()=>{
        const r=await fetch("/api/user/ai-config/models",{cache:"no-store"});
        if(!r.ok)throw Error(message(r.status));
        const data:Snapshot=await r.json();setSnapshot(data);setChains(data.chains);
    },[]);
    const reload=useCallback(async()=>{setBusy(true);try{await load();setNotice("");}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}},[load]);
    useEffect(()=>{void reload();},[reload,refreshKey]);
    async function save(){if(!snapshot)return;setBusy(true);try{
        const r=await fetch("/api/user/ai-config/order",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({revisions:snapshot.revisions,chains})});
        if(!r.ok)throw Error(message(r.status));
        await load();setNotice("调用顺序已保存。");
    }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
    return <section className="space-y-3 rounded border p-4"><h2 className="text-lg font-semibold">我的AI调用顺序</h2>
        <p>内置AI和个人AI可混合排序，按顺序尝试调用。解题和读图分别保存，读图只列出支持图片的模型。添加或导入个人模型后，请先保存配置。</p>
        {notice&&<p role="status">{notice}</p>}
        <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>void reload()}>重新加载顺序</button>
        <fieldset disabled={busy||!snapshot} className="space-y-3">
            <AIModelOrderEditor label="我的AI" models={snapshot?.models??[]} value={chains} onChange={setChains}/>
            <button type="button" className="rounded border px-3 py-2" onClick={()=>void save()}>保存调用顺序</button>
        </fieldset>
    </section>;
}
