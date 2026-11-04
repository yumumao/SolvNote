"use client";
import type { ModelOrder } from "@/lib/ai-access/model-order";

export type OrderModel={id:string;name:string;capabilities:("text"|"vision")[];source?:string};
export function availableOrder(models:OrderModel[], preferred:ModelOrder):ModelOrder {
    const order=(kind:keyof ModelOrder)=>[...new Set([...preferred[kind],...models.map(m=>m.id)])].filter(id=>models.some(m=>m.id===id&&m.capabilities.includes(kind)));
    return {text:order("text"),vision:order("vision")};
}
export function AIModelOrderEditor({models,value,onChange,label}:{models:OrderModel[];value:ModelOrder;onChange:(value:ModelOrder)=>void;label:string}){
    const chains=availableOrder(models,value);
    function move(kind:keyof ModelOrder,index:number,delta:number){
        const ids=[...chains[kind]];
        [ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];
        onChange({...chains,[kind]:ids});
    }
    return <div className="grid gap-4 sm:grid-cols-2">{(["text","vision"] as const).map(kind=>{
        const title=kind==="text"?"解题顺序":"读图顺序";
        return <section key={kind} aria-label={`${label}·${title}`} className="rounded border p-3">
            <h3 className="font-semibold">{title}</h3>
            {!chains[kind].length&&<p className="text-sm text-muted-foreground">暂无可用模型</p>}
            <ol className="space-y-2">{chains[kind].map((id,index)=>{
                const model=models.find(m=>m.id===id)!;
                return <li key={id} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{index+1}. {model.name}{model.source&&<small className="ml-2">{model.source==="private"?"个人":"内置"}</small>}</span>
                    <button type="button" className="rounded border px-2 py-1" aria-label={`${title}：上移${model.name}`} disabled={index===0} onClick={()=>move(kind,index,-1)}>↑</button>
                    <button type="button" className="rounded border px-2 py-1" aria-label={`${title}：下移${model.name}`} disabled={index===chains[kind].length-1} onClick={()=>move(kind,index,1)}>↓</button>
                </li>;
            })}</ol>
        </section>;
    })}</div>;
}
