"use client";
import {useEffect,useState} from "react";
import {apiClient} from "@/lib/api-client";
import {Button} from "./ui/button";
export function AIDialogueSettings(){
    const [settings,setSettings]=useState<{defaultRounds:number;revision:number}|null>(null),[value,setValue]=useState("10"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
    useEffect(()=>{let active=true;apiClient.get<{defaultRounds:number;revision:number}>("/api/ai/dialogue-settings").then(s=>{if(active){setSettings(s);setValue(String(s.defaultRounds));}}).catch(()=>{if(active)setMessage("默认轮数未能读取，请刷新后再试。");});return()=>{active=false;};},[]);
    async function save(){if(!settings)return;setBusy(true);try{const s=await apiClient.post<{defaultRounds:number;revision:number}>("/api/ai/dialogue-settings",{defaultRounds:Number(value),revision:settings.revision});setSettings(s);setMessage("已保存，仅影响新会话，已有会话保留原额度。");}catch{setMessage("保存失败：请输入1至100之间的整数；版本冲突请刷新。");}finally{setBusy(false);}}
    return <section className="border rounded-lg p-4 space-y-3"><h2 className="font-semibold">解题会话与轮数</h2><p className="text-sm">首次完成计1轮；澄清、补图和纠正不另扣轮数。每轮默认6次AI调用、10分钟活动时间，人工等待不计时。到限后只有管理员明确确认才能扩额。</p><label>新会话默认轮数<input aria-label="新会话默认轮数" className="border rounded p-2 mx-2 w-24 bg-background" type="number" min={1} max={100} step={1} value={value} onChange={e=>setValue(e.target.value)} disabled={!settings || busy}/></label><Button disabled={!settings || busy || !Number.isInteger(Number(value)) || Number(value)<1 || Number(value)>100} onClick={()=>void save()}>保存默认轮数</Button><p role="status" className="text-sm">{message}</p></section>;
}
