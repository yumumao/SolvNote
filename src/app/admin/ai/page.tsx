"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { AIConfigExport } from "@/components/ai-config-export";
import { AIOriginStatus } from "@/components/ai-origin-status";
import { AIConfigDeduplicate } from "@/components/ai-config-deduplicate";
import { apiClient, ApiError } from "@/lib/api-client";
import { importErrorMessage } from "@/lib/ai-config/import-errors";
import type { PortableConfig, AIProvider, AIModel } from "@/lib/ai-config/schema";
import { anotherKey, chainsFromOrder, eligible, inputKinds, moveInOrder, validChains, type InputKind } from "@/lib/ai-config/editor";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const empty: PortableConfig = { version: 1, providers: [], models: [], chains: { text: [], vision: [] } };
const inputStyle = "border rounded-md p-2 bg-background w-full min-w-0";
const buttonStyle = "border rounded-md px-3 py-2 text-sm disabled:opacity-40 hover:bg-muted";
import { AIDrawingSettings } from "@/components/ai-drawing-settings";
import { AIDialogueSettings } from "@/components/ai-dialogue-settings";
const taskName=(kind:InputKind)=>kind==="text"?"解题/问答":"识图/补读";
const kindName = (kind: InputKind) => kind === "text" ? "文字" : "图片/图文";

function ConfigSummary({ config }: { config: PortableConfig }) {
    const label = (id: string) => {
        const m = config.models.find((m) => m.id === id);
        return m ? `${m.name}（${config.providers.find((p) => p.id === m.providerId)?.name}）` : id;
    };
    return <div className="space-y-3 text-sm">
        <p>{config.providers.length}条连接 · {config.models.length}个模型</p>
        {config.providers.map((p) => <div key={p.id} className="border rounded p-3 break-words">
            <strong>{p.name}</strong><span> · {p.protocol}{!p.enabled && " · 已停用"}</span>
            <ul className="mt-1 space-y-1">{config.models.filter((m) => m.providerId === p.id).map((m) =>
                <li key={m.id}>{m.name} · {m.model} · {m.capabilities.map(kindName).join("＋")}{!m.enabled && " · 已停用"}</li>)}</ul>
        </div>)}
        {inputKinds.map((k) => <p key={k} className="break-words"><strong>{taskName(k)}顺序：</strong>{config.chains[k].map(label).join(" → ") || "未配置"}</p>)}
    </div>;
}

function ModelDetails({ model, children }: { model: AIModel; children: ReactNode }) {
    return <section data-model-editor className="border rounded-md">
        <h4 className="p-3 text-sm font-medium break-words">{model.name} · {model.model || "待填写模型名"} · {model.capabilities.map(kindName).join("＋")}{!model.enabled && " · 已停用"}</h4>
        {children}
    </section>;
}

export default function AIManagement() {
    const [config, setConfig] = useState<PortableConfig>(empty);
    const [revision, setRevision] = useState(0);
    const [message, setMessage] = useState("加载中…");
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState<string | null>(null);
    const testLock = useRef(false);
    const saveLock = useRef(false);
    const [testResults, setTestResults] = useState<Record<string, string>>({});
    const [loaded, setLoaded] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [order, setOrder] = useState<string[] | null>(null);
    const [openConnection, setOpenConnection] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [envelope, setEnvelope] = useState<unknown>();
    const [password, setPassword] = useState("");
    const [mode, setMode] = useState("merge");
    const [preview, setPreview] = useState<{ config: PortableConfig; revision: number; expires: number; previewToken: string } | null>(null);
    const fileSequence = useRef(0);
    const importInFlight = useRef(false);

    const acceptConfig = (c: PortableConfig, r: number) => {
        setConfig(c); setRevision(r); setOrder(null); setDirty(false); setTestResults({});
    };
    useEffect(() => {
        let active = true;
        apiClient.get<{ config: PortableConfig; revision: number }>("/api/ai/config")
            .then((r) => {
                if (!active) return;
                acceptConfig(r.config, r.revision); setLoaded(true);
                setMessage("配置仅管理员可见。密钥由服务端加密保存，星号表示保持原值。");
            }).catch(() => { if (active) setMessage("无法读取：请确认以启用的管理员账户登录。"); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty]);

    const edit = (next: PortableConfig, nextOrder = order) => {
        const chains = nextOrder === null ? validChains(next) : chainsFromOrder(next, nextOrder);
        if (inputKinds.some((k) => chains[k].length > 30)) {
            setMessage("每种任务最多选用30个模型，请先移除不需要的模型。"); return;
        }
        const selectedOrder = nextOrder?.filter((id) => {
            const model = next.models.find((m) => m.id === id);
            return model && inputKinds.some((k) => eligible(next, model, k));
        }) ?? null;
        setConfig({ ...next, chains }); setOrder(selectedOrder); setDirty(true);
    };
    const changeProvider = (id: string, patch: Partial<AIProvider>) => edit({ ...config,
        providers: config.providers.map((p) => p.id === id ? { ...p, ...patch } : p),
    });
    const changeModel = (id: string, patch: Partial<AIModel>) => edit({ ...config,
        models: config.models.map((m) => m.id === id ? { ...m, ...patch } : m),
    });
    const addConnection = (source?: string) => {
        const id = `p-${crypto.randomUUID()}`;
        const next: PortableConfig = source ? anotherKey(config, source, id) : { ...config,
            providers: [...config.providers, { id, name: "新连接", baseUrl: "https://api.openai.com/v1", protocol: "chat", apiKey: "", enabled: true }],
        };
        edit(next); setOpenConnection(id);
    };
    const addModel = (providerId: string) => {
        const id = `m-${crypto.randomUUID()}`;
        edit({ ...config, models: [...config.models, { id, providerId, name: "新模型", model: "", enabled: true, capabilities: ["text"] }] },
            order === null ? null : [...order, id]);
    };
    const removeModel = (id: string) => {
        if (!window.confirm("移除这个模型及其调用顺序？保存后才会生效。")) return;
        edit({ ...config, models: config.models.filter((m) => m.id !== id) }, order?.filter((x) => x !== id) ?? null);
    };
    const save = async () => {
        if (saveLock.current || busy || testing || !loaded || !dirty) return;
        saveLock.current = true; setBusy(true);
        try {
            const r = await apiClient.post<{ config: PortableConfig; revision: number }>("/api/ai/config", { config, revision });
            acceptConfig(r.config, r.revision);
            setMessage("配置已保存。已排队任务在执行时采用当时配置。");
        } catch { setMessage("保存失败：检查模型名称、HTTPS地址、密钥和调用顺序；版本冲突请刷新。更换地址或协议需重新填写密钥。"); }
        finally { saveLock.current = false; setBusy(false); }
    };
    const testModel = async (model: AIModel) => {
        if (testLock.current || dirty || busy || !loaded) return;
        if (!window.confirm(`测试${model.name}的连通性？将用已保存的连接发送1次极短文字请求，可能产生费用。不发送题目或图片，不自动重试，也不验证图像能力。`)) return;
        testLock.current = true; setTesting(model.id); setBusy(true);
        try {
            const result = await apiClient.post<{success:boolean;elapsedMs:number}>("/api/ai/config/test", {modelId:model.id,revision});
            setTestResults(prev => ({...prev,[model.id]:result.success ? `连通成功 · ${(result.elapsedMs/1000).toFixed(1)}秒（仅文字通信，不代表解题或读图质量）` : "未确认成功；请核对供应商记录，不自动重试。"}));
        } catch (e) {
            const data = e instanceof ApiError ? e.data as {code?:string;message?:string} : undefined;
            const labels:Record<string,string> = {AI_ENDPOINT_REJECTED:"地址被安全校验拒绝，请检查HTTPS地址与服务端出口。",AI_AUTH_ERROR:"认证失败，请检查连接密钥与模型权限。",AI_RATE_LIMIT:"供应商限流或额度受限。",AI_HTTP_404:"模型名、部署名或API路径不存在。",AI_HTTP_400:"供应商不接受当前请求格式，请检查API协议。",AI_TEST_BUSY:"另一项测试正在进行，请等待。",CONFIG_CONFLICT:"配置版本已变化，请刷新后核对。",FORBIDDEN:"无权限或同源校验未通过，请检查登录及正式地址。"};
            const detail = labels[data?.code || data?.message || ""] || "上游受理状态未确认（包括超时）；可能已经收费，请先核对供应商记录，不要连续重试。";
            setTestResults(prev => ({...prev,[model.id]:`测试未通过：${detail}`}));
        } finally { testLock.current = false; setTesting(null); setBusy(false); }
    };
    const importing = async (action: "preview" | "apply") => {
        importInFlight.current = true; setBusy(true);
        try {
            const r = await apiClient.post<{ config: PortableConfig; revision: number; expires: number; previewToken: string }>("/api/ai/config/import", {
                envelope, password, mode, action,
                ...(action === "apply" ? { revision: preview?.revision, expires: preview?.expires, previewToken: preview?.previewToken } : {}),
            });
            if (action === "preview") { setPreview(r); setMessage("预览已解密但尚未写入，请确认连接、模型和顺序。"); }
            else {
                acceptConfig(r.config, r.revision); setPreview(null); setPassword(""); setEnvelope(undefined); setImportOpen(false);
                setMessage("导入完成，原有非AI设置不变。");
            }
        } catch (error) { setPreview(null); setMessage(importErrorMessage(error, action)); }
        finally { importInFlight.current = false; setBusy(false); }
    };
    const modelLabel = (id: string) => {
        const m = config.models.find((m) => m.id === id);
        return m ? `${m.name} · ${config.providers.find((p) => p.id === m.providerId)?.name}` : id;
    };
    const renderOrder = (kind?: InputKind) => {
        const ids = kind ? config.chains[kind] : order || [];
        const update = (ids: string[]) => kind ? edit({ ...config, chains: { ...config.chains, [kind]: ids } }, null) : edit(config, ids);
        const candidates = config.models.filter((m) => !ids.includes(m.id) &&
            (kind ? eligible(config, m, kind) : inputKinds.some((k) => eligible(config, m, k))));
        return <div className="space-y-2">
            {!ids.length && <p className="text-sm text-muted-foreground">尚未选用模型。</p>}
            {ids.map((id, i) => <div key={id} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
                <span className="min-w-0 flex-1 break-words text-sm">{i + 1}. {modelLabel(id)}</span>
                <button className={buttonStyle} aria-label={`${kind || "共用"}上移${modelLabel(id)}`} disabled={!i} onClick={() => update(moveInOrder(ids, i, -1))}>↑</button>
                <button className={buttonStyle} aria-label={`${kind || "共用"}下移${modelLabel(id)}`} disabled={i === ids.length - 1} onClick={() => update(moveInOrder(ids, i, 1))}>↓</button>
                <button className={buttonStyle} aria-label={`${kind || "共用"}移除${modelLabel(id)}`} onClick={() => update(ids.filter((x) => x !== id))}>不选用</button>
            </div>)}
            <select aria-label={kind ? `添加${kind}链模型` : "添加共用顺序模型"} className={inputStyle} value="" onChange={(e) => { if (e.target.value) update([...ids, e.target.value]); }}>
                <option value="">{candidates.length ? "选用已有模型…" : "没有其他可用模型"}</option>
                {candidates.map((m) => <option key={m.id} value={m.id}>{modelLabel(m.id)}</option>)}
            </select>
        </div>;
    };
    return <main className="max-w-4xl mx-auto p-4 sm:p-6 pb-36 sm:pb-32 space-y-6">
        <nav className="flex gap-5 text-sm"><Link href="/">返回首页</Link><Link href="/ai-tasks">我的AI任务</Link></nav>
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="text-2xl font-bold">AI设置</h1><p className="text-sm text-muted-foreground mt-1">先添加连接，再添加这把Key可用的模型。</p></div>
            <div className="flex flex-wrap gap-2">
                <AIConfigExport disabled={busy || !loaded || dirty} revision={revision} />
                <AIConfigDeduplicate disabled={busy || !loaded || dirty} onApplied={(c, r) => { acceptConfig(c, r); setMessage("已应用合并，调用顺序已更新。密钥仍由服务端加密保存。"); }} />
                <Dialog open={importOpen} onOpenChange={(open) => {
                    if (importInFlight.current) return;
                    if (open && dirty && !window.confirm("导入基于已保存配置，未保存的编辑不会合并。继续查看导入？")) return;
                    setImportOpen(open);
                    if (!open) { fileSequence.current++; setPreview(null); setEnvelope(undefined); setPassword(""); }
                }}>
                    <DialogTrigger asChild><button className={buttonStyle} disabled={busy || !loaded}>导入配置</button></DialogTrigger>
                    <DialogContent className="max-h-[85vh] overflow-y-auto max-w-2xl">
                        <DialogHeader><DialogTitle>导入加密AI配置</DialogTitle><DialogDescription>兼容ScanDex导出文件，先预览再写入；仅管理员可操作。</DialogDescription></DialogHeader>
                        <fieldset disabled={busy} className="space-y-3 min-w-0">
                            <p className="text-sm">合并时同ID使用导入值；替换会移除现有AI配置，不影响题目和账户。未保存的编辑不参与导入。</p>
                            <input aria-label="加密配置文件" type="file" accept=".json" className="w-full" onChange={async (e) => {
                                const sequence = ++fileSequence.current;
                                setPreview(null); setEnvelope(undefined);
                                const f = e.target.files?.[0]; if (!f) return;
                                if (f.size > 1024 * 1024) { setMessage("文件不能超过1MiB"); return; }
                                try {
                                    const data: unknown = JSON.parse(await f.text());
                                    if (sequence !== fileSequence.current) return;
                                    setEnvelope(data); setMessage("文件已选择，输入口令后预览。");
                                } catch { if (sequence === fileSequence.current) setMessage("文件不是有效JSON"); }
                            }} />
                            <label className="block">导出口令<input className={inputStyle} type="password" autoComplete="off" value={password} onChange={(e) => { setPassword(e.target.value); setPreview(null); }} placeholder="独立导出口令（至少12个字符）" /></label>
                            <label className="block">导入方式<select className={inputStyle} value={mode} onChange={(e) => { setMode(e.target.value); setPreview(null); }}><option value="merge">合并</option><option value="replace">替换全部AI配置</option></select></label>
                            <button className={buttonStyle} disabled={!envelope || password.length < 12} onClick={() => importing("preview")}>解密并预览（不写入）</button>
                            {preview && <div className="space-y-3"><ConfigSummary config={preview.config} /><button className={buttonStyle} onClick={() => importing("apply")}>确认{mode === "replace" ? "替换" : "合并"}导入</button></div>}
                        </fieldset>
                        <p role="status" className="text-sm">{message}</p>
                    </DialogContent>
                </Dialog>

            </div>
        </header>
        <AIOriginStatus />
        <p role="status" className="text-sm rounded-md bg-muted p-3">{message}{dirty && " · 有未保存修改"}</p>
        <fieldset disabled={busy || !loaded || !!testing} className="space-y-6 min-w-0">
            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">连接与模型</h2><button className={buttonStyle} disabled={config.providers.length >= 50} onClick={() => addConnection()}>＋添加连接</button></div>
                <p className="text-sm text-muted-foreground">一张连接卡片对应一把Key。同一API地址可添加不同Key，每把Key下可配置多个模型。</p>
                {!config.providers.length && <p className="border border-dashed rounded-lg p-6 text-sm">还没有连接。添加连接，或从ScanDex导入加密配置。</p>}
                {config.providers.map((p) => <Dialog key={p.id} open={openConnection === p.id} onOpenChange={(open) => { if (!busy && !testing) setOpenConnection(open ? p.id : null); }}>
                    <div data-connection-card className="border rounded-lg p-4 bg-muted/40 flex items-center gap-3 min-w-0">
                        <div className="flex-1 min-w-0">
                            <DialogTrigger asChild><button className="font-semibold text-left break-words hover:underline">{p.name}</button></DialogTrigger>
                            <p className="text-sm text-muted-foreground">{config.models.filter((m) => m.providerId === p.id).length}个模型 · {p.enabled ? "已启用" : "已停用"} · {p.protocol}</p>
                        </div>
                        <DialogTrigger asChild><button className={buttonStyle} aria-label={`设置连接：${p.name}`} title="设置连接与模型"><Settings2 className="size-4" /></button></DialogTrigger>
                    </div>
                    <DialogContent className="sm:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden p-0 gap-0">
                        <DialogHeader className="shrink-0 p-5 pr-12 border-b">
                            <DialogTitle className="break-words">连接设置 · {p.name}</DialogTitle>
                            <DialogDescription>一把Key下管理多个模型。关闭保留页面草稿；保存会提交全部连接、模型和调用顺序，不包含下方单独保存的会话及绘图设置。</DialogDescription>
                        </DialogHeader>
                        <div data-connection-scroll className="min-h-0 min-w-0 overflow-y-auto p-4">
                        <fieldset disabled={busy || !loaded || !!testing} className="min-w-0 space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <label>连接名称<input className={inputStyle} value={p.name} onChange={(e) => changeProvider(p.id, { name: e.target.value })} placeholder="例如：某平台·个人Key" /></label>
                            <label>API协议<select className={inputStyle} value={p.protocol} onChange={(e) => changeProvider(p.id, { protocol: e.target.value as AIProvider["protocol"] })}>{["chat", "responses", "responses_codex", "gemini", "azure"].map((x) => <option key={x}>{x}</option>)}</select></label>
                            <label>API基础地址<input className={inputStyle} value={p.baseUrl} onChange={(e) => changeProvider(p.id, { baseUrl: e.target.value })} /></label>
                            <label>API密钥<input className={inputStyle} type="password" autoComplete="off" value={p.apiKey} onChange={(e) => changeProvider(p.id, { apiKey: e.target.value })} placeholder="填写这条连接专用的Key" /></label>
                            {p.protocol === "azure" && <label>API版本<input className={inputStyle} value={p.apiVersion || ""} onChange={(e) => changeProvider(p.id, { apiVersion: e.target.value })} /></label>}
                        </div>
                        <p className="text-xs text-muted-foreground">星号保持已保存密钥；修改API地址或协议时需重新填写密钥。读图能力在模型中设置。停用会移出调用顺序，重新启用后需在下方选用。</p>
                        <div className="flex flex-wrap gap-3 items-center text-sm">
                            <label className="flex gap-2"><input type="checkbox" checked={p.enabled} onChange={(e) => changeProvider(p.id, { enabled: e.target.checked })} />启用连接</label>
                            <button className={buttonStyle} disabled={config.providers.length >= 50} onClick={() => addConnection(p.id)}>同地址添加另一把Key</button>
                            <button className={buttonStyle} onClick={() => {
                                if (!window.confirm("移除这条连接及其所有模型？保存后才会生效。")) return;
                                const ids = config.models.filter((m) => m.providerId === p.id).map((m) => m.id);
                                edit({ ...config, providers: config.providers.filter((x) => x.id !== p.id), models: config.models.filter((m) => m.providerId !== p.id) }, order?.filter((id) => !ids.includes(id)) ?? null);
                            }}>移除连接</button>
                        </div>
                        <div className="space-y-2 border-t pt-3">
                            <h3 className="text-sm font-semibold">这把Key的模型</h3><p className="text-xs text-muted-foreground">测试仅使用已保存配置。每次1个文字请求、最多等待20秒，可能收费；不检测图片能力，不自动修改能力或调用顺序。</p>
                            {config.models.filter((m) => m.providerId === p.id).map((m) => <ModelDetails key={m.id} model={m}>
                                <div className="p-3 pt-0 space-y-3">
                                    <div className="space-y-2"><button className={buttonStyle} disabled={dirty || busy || !!testing || !p.enabled || !m.enabled || !m.capabilities.includes("text")} onClick={() => void testModel(m)}>{testing === m.id ? "测试中…" : "测试连通性"}</button>
                                    {dirty && <p className="text-xs">请先保存修改，再测试当前配置。</p>}
                                    {testResults[m.id] && <p role="status" className="text-sm">{dirty ? "上次已保存配置的测试：" : ""}{testResults[m.id]}</p>}</div>
                                    <div className="grid sm:grid-cols-2 gap-3 text-sm"><label>显示名称<input className={inputStyle} value={m.name} onChange={(e) => changeModel(m.id, { name: e.target.value })} /></label><label>上游模型/部署名<input className={inputStyle} value={m.model} onChange={(e) => changeModel(m.id, { model: e.target.value })} placeholder="填写平台实际提供的模型名称" /></label></div>
                                    <div className="flex flex-wrap gap-4 text-sm items-center">
                                        <label className="flex gap-2"><input type="checkbox" checked={m.enabled} onChange={(e) => changeModel(m.id, { enabled: e.target.checked })} />启用模型</label>
                                        <span>{m.capabilities.includes("text") ? "文字 ✓" : "仅图片（旧配置保留）"}</span>
                                        {!m.capabilities.includes("text") && <button className={buttonStyle} onClick={() => changeModel(m.id, { capabilities: ["text", ...m.capabilities] })}>允许文字输入</button>}
                                        <label className="flex gap-2"><input type="checkbox" checked={m.capabilities.includes("vision")} onChange={(e) => {
                                            if (!e.target.checked && !m.capabilities.includes("text")) { setMessage("此旧模型仅支持图片，请先明确允许文字输入，或停用模型。"); return; }
                                            changeModel(m.id, { capabilities: e.target.checked ? [...m.capabilities.filter((c) => c !== "vision"), "vision"] : m.capabilities.filter((c) => c !== "vision") });
                                        }} />支持读图（多模态）</label>
                                        <button className={buttonStyle} onClick={() => removeModel(m.id)}>移除模型</button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">勾选表示允许使用模型已有的读图能力，不代表图片生成。{order === null ? "独立顺序模式：新增或启用后，请在下方选用模型。" : "共用顺序会按能力自动筛选，不支持读图的模型不会收到图片。"}</p>
                                </div>
                            </ModelDetails>)}
                            <button className={buttonStyle} disabled={config.models.length >= 200} onClick={() => addModel(p.id)}>＋添加模型</button>
                        </div>
                        </fieldset>
                        </div>
                        <footer data-connection-save className="shrink-0 border-t p-4 bg-background space-y-3">
                            <p role="status" className="text-sm break-words">{message}{dirty && " · 有未保存修改"}</p>
                            <div className="flex flex-wrap justify-end gap-2">
                                <button className={buttonStyle} disabled={busy || !!testing} onClick={() => setOpenConnection(null)}>关闭（保留草稿）</button>
                                <button className="rounded-md bg-primary text-primary-foreground px-4 py-2 disabled:opacity-40" disabled={busy || !!testing || !loaded || !dirty} onClick={save}>{busy ? "处理中…" : "保存全部AI设置"}</button>
                            </div>
                        </footer>
                    </DialogContent>
                </Dialog>)}
            </section>
            <section className="space-y-3 border rounded-lg p-4">
                <h2 className="font-semibold">两种调用顺序</h2>
                <p className="text-sm text-muted-foreground">解题按解题顺序调用，支持图片的解题模型同时收到题图；文字模型只收到转录与条件。识图及定向补读只使用读图模型。明确失败才回退，受理未知不重发。</p>
                <div className="grid sm:grid-cols-2 gap-4">{inputKinds.map(k=><div key={k} className="space-y-2"><h3 className="text-sm font-semibold">{taskName(k)}顺序</h3>{renderOrder(k)}</div>)}</div>
                <p className="text-sm">已有配置的选用范围与顺序保持不变；新模型请在对应顺序中选用。会话每轮默认6次调用，旧式短任务仍最多3次。</p>
                <div className="text-xs text-muted-foreground space-y-1">{inputKinds.map((k) => <p key={k} className="break-words">{taskName(k)}实际顺序：{config.chains[k].map(modelLabel).join(" → ") || "未选用（该类任务无法调用AI）"}</p>)}</div>
            </section>
        </fieldset>
        <AIDialogueSettings/>
        <AIDrawingSettings/>
        <p className="text-xs text-muted-foreground">年级只影响讲解难度，正确解题优先；需要时使用更高年级知识并解释。同题会话先做忠实转录，再按解题顺序调用；图片只发送给支持读图的模型。</p>
        <aside aria-label="AI设置保存栏" className="fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 shadow-lg backdrop-blur pb-[env(safe-area-inset-bottom)]">
            <div className="max-w-4xl mx-auto flex items-center gap-3 p-3 sm:px-6">
                <p role="status" className="text-sm flex-1 min-w-0 break-words">{message}{dirty && " · 有未保存修改"}</p>
                <button className="shrink-0 bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-40" disabled={busy || !!testing || !loaded || !dirty} onClick={save}>{busy ? "处理中…" : "保存设置"}</button>
            </div>
        </aside>
    </main>;
}
