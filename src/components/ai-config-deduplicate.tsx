"use client";
import { useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { PortableConfig } from "@/lib/ai-config/schema";
import type { DedupePreview, MergeChoice, MergeGroup } from "@/lib/ai-config/deduplicate";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const button = "border rounded-md px-3 py-2 text-sm disabled:opacity-40 hover:bg-muted";
const capability = (k: string) => k === "vision" ? "读图" : "文字";
function Summary({ config }: { config: PortableConfig }) {
    const modelLabel = (id: string) => {
        const m = config.models.find(m => m.id === id);
        return m ? `${m.name}（${config.providers.find(p => p.id === m.providerId)?.name}）` : id;
    };
    return <div className="space-y-2 text-sm break-words">
        <p>{config.providers.length}条连接 · {config.models.length}个模型</p>
        {config.providers.map(p => <div key={p.id} className="border rounded p-2">
            <strong>{p.name}</strong> · {p.protocol}{p.apiVersion && ` · ${p.apiVersion}`}{!p.enabled && " · 已停用"}
            <p className="text-xs text-muted-foreground break-all">{p.baseUrl}</p>
            <ul>{config.models.filter(m => m.providerId === p.id).map(m => <li key={m.id}>
                {m.name} · {m.model} · {m.capabilities.map(capability).join("＋")}{!m.enabled && " · 已停用"}
            </li>)}</ul>
        </div>)}
        {(["text", "vision"] as const).map(k => <p key={k}><strong>{k === "text" ? "文字" : "图片/图文"}顺序：</strong>{config.chains[k].map(modelLabel).join(" → ") || "未配置"}</p>)}
    </div>;
}

export function AIConfigDeduplicate({ disabled, onApplied }: {
    disabled: boolean;
    onApplied: (config: PortableConfig, revision: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [preview, setPreview] = useState<DedupePreview | null>(null);
    const [choices, setChoices] = useState<MergeChoice[]>([]);
    const [stale, setStale] = useState(false);
    const [regroup, setRegroup] = useState(false);
    const [message, setMessage] = useState("");
    function reset() { setPreview(null); setChoices([]); setStale(false); setRegroup(false); setMessage(""); }
    async function run(action: "preview" | "apply") {
        if (inFlight.current || disabled || (action === "apply" && (!preview?.changed || stale))) return;
        inFlight.current = true; setBusy(true); setMessage("");
        try {
            const url = "/api/ai/config/deduplicate";
            if (action === "preview") {
                const next = await apiClient.post<DedupePreview>(url, { action, choices });
                setPreview(next); setStale(false); setRegroup(false);
                setMessage(next.changed ? "预览尚未保存。请核对保留项和两类任务的调用顺序，再确认应用。" : "没有需要应用的变更。不同Key、不同协议或路径会保持分开。");
            } else if (preview) {
                const r = await apiClient.post<{ config: PortableConfig; revision: number }>(url, {
                    action, choices, revision: preview.revision, expires: preview.expires,
                    nonce: preview.nonce, previewToken: preview.previewToken,
                });
                onApplied(r.config, r.revision); setOpen(false); reset();
            }
        } catch {
            reset(); setMessage("操作未完成：配置可能已变化、预览已过期或服务暂不可用。请重新检测；若刚才在应用，请先刷新核对已保存状态。未自动重试。");
        } finally { inFlight.current = false; setBusy(false); }
    }
    function choose(group: MergeGroup, keepId: string | null) {
        setChoices(previous => [...previous.filter(c =>
            !(c.kind === group.kind && c.groupId === group.groupId) && !(group.kind === "connection" && c.kind === "model")
        ), { kind: group.kind, groupId: group.groupId, keepId }]);
        setStale(true); if (group.kind === "connection") setRegroup(true);
        setMessage("选择已更改，旧预览不可应用。请按当前选择重新预览；调整连接后会重新检测模型分组。");
    }
    const name = (id: string) => `${preview?.before.providers.find(p => p.id === id)?.name ?? id}（${id}）`;
    return <Dialog open={open} onOpenChange={next => { if (inFlight.current) return; setOpen(next); reset(); }}>
        <DialogTrigger asChild><button className={button} disabled={disabled} title={disabled ? "请先保存当前修改，检测仅基于已保存配置" : "服务端比较真实Key，不调用AI"}>检测与合并</button></DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>检测与合并重复配置</DialogTitle><DialogDescription>仅管理员可用，检测已保存配置，不调用AI、不产生AI费用。检测不会写入；确认应用才保存。</DialogDescription></DialogHeader>
            <p className="text-sm">仅完整API地址、协议、API版本及非空真实Key相同的连接可合并。不同Key分别保留；同连接按实际模型/部署名去重，不按显示名称。</p>
            <button className={button} disabled={busy || disabled} onClick={() => run("preview")}>{preview ? "按当前选择重新预览" : "检测已保存配置"}</button>
            {preview && <div className="space-y-4 min-w-0">
                <section className="space-y-2 text-sm"><h3 className="font-semibold">同地址Key比较</h3>
                    <p>只返回相同/不同分组，不返回Key或Key指纹。不同组的Key不同；空值、空白或掩码无法判断。</p>
                    {preview.endpoints.length === 0 && <p>没有重复API地址。</p>}
                    {preview.endpoints.map((e, i) => <div key={i} className="border rounded p-3 break-words">
                        <p className="break-all">{preview.before.providers.find(p => p.id === e.connectionIds[0])?.baseUrl}</p>
                        {e.keyGroups.map((ids, j) => <p key={j}>{ids.length > 1 ? "Key相同" : "独立Key"}：{ids.map(name).join("、")}</p>)}
                        {e.unknownIds.length > 0 && <p>Key无法判断：{e.unknownIds.map(name).join("、")}</p>}
                        <p className="text-muted-foreground">Key相同仍须协议及API版本一致，才会建议合并。</p>
                    </div>)}
                </section>
                <fieldset disabled={busy} className="space-y-3 min-w-0"><legend className="font-semibold">选择保留项</legend>
                    {preview.groups.length === 0 && <p className="text-sm">没有可合并的重复连接或模型。</p>}
                    {preview.groups.filter(g => !regroup || g.kind !== "model").map(g => {
                        const choice = choices.find(c => c.kind === g.kind && c.groupId === g.groupId);
                        const value = choice ? choice.keepId : g.keepId;
                        const title = `${g.kind === "connection" ? "连接" : "模型"}合并 ${g.groupId}`;
                        return <div key={`${g.kind}:${g.groupId}`} className="border rounded p-3 space-y-2 text-sm">
                            <p className="font-medium">{g.kind === "connection" ? "重复连接" : "重复模型"}：{g.members.map(m => m.label).join("、")}</p>
                            {g.conflict && <p className="text-amber-700 dark:text-amber-400">能力或启用状态不同，默认保留分开。选定一条后采用该条设置，不自动合并能力或启用状态。</p>}
                            <ul className="text-muted-foreground">{g.members.map(m => <li key={m.id}>{m.label}（{m.id}） · {m.enabled ? "启用" : "停用"}{m.capabilities && ` · ${m.capabilities.map(capability).join("＋")}`}</li>)}</ul>
                            <label className="block">保留方式<select aria-label={title} className="border rounded p-2 w-full bg-background" value={value ?? ""} onChange={e => choose(g, e.target.value || null)}>
                                <option value="">保留分开（不合并此组）</option>
                                {g.members.map(m => <option value={m.id} key={m.id}>保留 {m.label}（{m.id}）</option>)}
                            </select></label>
                        </div>;
                    })}
                </fieldset>
                {regroup && <p className="text-sm">连接选择已变，模型分组将在重新预览后显示。</p>}
                <p className="text-sm">按各任务原顺序保留首次出现的位置并去重，不自动加入新的任务。选择停用项或能力较少的模型，可能使部分调用顺序变短或为空，请核对下方预览。</p>
                {stale && <p className="font-medium">以下是旧预览，尚未包含刚才的选择，不能应用。</p>}
                <div className="grid sm:grid-cols-2 gap-4 min-w-0">
                    <section className="min-w-0"><h3 className="font-semibold mb-2">合并前</h3><Summary config={preview.before} /></section>
                    <section className="min-w-0"><h3 className="font-semibold mb-2">合并后（预览）</h3><Summary config={preview.config} /></section>
                </div>
                <button className={button} disabled={busy || disabled || stale || !preview.changed} onClick={() => run("apply")}>确认应用合并</button>
                <p className="text-xs text-muted-foreground">预览5分钟有效。其他管理员保存后须重新检测，防止覆盖新配置。</p>
            </div>}
            <p role="status" className="text-sm">{busy ? "处理中…" : message}</p>
        </DialogContent>
    </Dialog>;
}
