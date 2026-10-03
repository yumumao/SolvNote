"use client";
import {IllustrationSettings} from "./illustration-settings";
import {useState} from "react";
import {apiClient} from "@/lib/api-client";
import {Button} from "./ui/button";
type Settings={revision:number;configRevision:number;modelId:string|null;enabled:boolean;models:{id:string;name:string;model:string;providerName:string}[]};
export function AIDrawingSettings(){
    const [settings,setSettings]=useState<Settings>(),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
    async function load(){setBusy(true);try{const s=await apiClient.get<Settings>("/api/ai/drawing-settings");setSettings(s);setSelected(s.modelId||"");setMessage("");}catch{setMessage("读取失败，请刷新重试。");}finally{setBusy(false);}}
    async function save(){if(!settings)return;if(selected&&!window.confirm("请确认该模型确实支持Gemini图片输出/编辑，而不只是识图。启用后用户可显式发送原题图进行辅助线编辑，可能产生费用。"))return;setBusy(true);try{const s=await apiClient.post<Settings>("/api/ai/drawing-settings",{modelId:selected||null,revision:settings.revision,configRevision:settings.configRevision});setSettings(s);setMessage("已保存独立作图设置。不会改变识图/解题调用顺序，也不改变ScanDex导入导出格式。");}catch{setMessage("保存失败：请重新读取并确认连接、模型和配置版本。未自动切换到其他模型。");}finally{setBusy(false);}}
    return <section className="border rounded-lg p-4 space-y-3"><h2 className="font-semibold">可选图片生成与辅助作图</h2><p className="text-sm">几何辅助线无需Gemini或生图API：在题目编辑页的几何辅助线区域，复用现有文字/识图AI生成结构化底图，人工核对锁定后添加分步辅助线。本地SVG绘制免费，生成构造方案仍可能收费；示意图不替换原题图。</p><IllustrationSettings/><details className="border-t pt-3"><summary className="cursor-pointer font-semibold">可选Gemini整图编辑（没有API可忽略）</summary><div className="space-y-3 pt-3"><p className="text-sm">此可选整图编辑通道只支持Gemini协议的图片输出模型；能识图不代表能改图，与上方MiniMax创作配图相互独立。复用已保存的连接/Key，必须在此单独指定。先保存上方AI配置，再读取本列表；修改地址、Key或模型名称后需重新确认。此站专用授权不随ScanDex配置文件导出。</p><Button variant="outline" disabled={busy} onClick={()=>void load()}>读取/刷新图片编辑设置</Button>
        {settings && <><label className="block">辅助线图片编辑<select aria-label="辅助线图片编辑模型" className="border rounded p-2 w-full bg-background" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">停用（仍可使用分步构造）</option>{settings.modelId && !settings.models.some(m=>m.id===settings.modelId) && <option value={settings.modelId}>原模型已不可用，请重新选择</option>}{settings.models.map(m=><option key={m.id} value={m.id}>{m.name}（{m.model}） · 所属连接：{m.providerName}</option>)}</select></label><p className="text-sm">{settings.enabled?"已启用。":"当前未生效：未指定、模型不可用或连接凭据已变更。"}</p><Button disabled={busy} onClick={()=>void save()}>保存图片编辑设置</Button></>}
        <p role="status" className="text-sm">{message}</p></div></details>
    </section>;
}
