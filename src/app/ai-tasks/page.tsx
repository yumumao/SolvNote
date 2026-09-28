"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import { diagnosticMessage } from "@/lib/ai/diagnostics";
import {DrawingResultPreview} from "@/components/auxiliary-drawing";
import { ApiError, apiClient } from "@/lib/api-client";
import { dialogueLabels } from "@/components/ai-conversation";
type ConversationSummary={id:string;state:string;roundsUsed:number;roundLimit:number;updatedAt:string};
type JobDetail = {
    id: string;
    kind: string;
    state: string;
    attemptsLog?: unknown;
    result?: unknown;
    errorCode?: string;
    input?: { subjectId?: string; questionText?: string; drawingCorrection?: string; imageBase64?: string; originalImageBase64?: string; mimeType?: string };
};
type Job = {
    id: string;
    kind: string;
    state: string;
    attempts: number;
    errorCode?: string;
    createdAt: string;
};
const labels: Record<string, string> = {
    pending: "排队中",
    running: "处理中",
    success: "已完成",
    failed: "失败",
    unknown: "受理状态不确定（未自动重发）",
    cancelled: "已取消",
};
function originalImage(input: JobDetail["input"]) {
    const image = input?.originalImageBase64 || input?.imageBase64;
    if (!image || image.startsWith("data:")) return image;
    return /^image\/(png|jpeg|webp)$/.test(input?.mimeType || "")
        ? "data:" + input!.mimeType + ";base64," + image : undefined;
}
function readFailureMessage(error: unknown) {
    const code = error instanceof ApiError && error.data && typeof error.data === "object" && "message" in error.data ? error.data.message : undefined;
    const reason = error instanceof ApiError ? (
        error.status === 401 ? "登录状态已失效，请重新登录后读取。" :
        error.status === 403 ? code === "AI_MODEL_ACCESS_REVOKED" ? "本任务涉及的模型使用权限已变更，请联系管理员核对授权。" : "账号或会话权限已变更，请重新登录或联系管理员。" :
        error.status === 404 ? "任务不存在或已过期；临时绘图结果保留24小时，解题记录不受此期限影响。" :
        error.status === 408 ? "读取超时，尚不能判定任务不存在或已过期。请稍后重试。" :
        error.status >= 500 ? "服务暂时不可用，请稍后重试；持续失败时请管理员检查服务日志。" :
        "任务数据或服务配置异常，请联系管理员核对；不要重复生成。"
    ) : "网络读取中断，请检查连接后重试。";
    return "暂时无法读取任务：" + reason + " 可重新读取本次任务；不会重新提交AI。";
}
export default function AITasks() {
    const [conversations,setConversations]=useState<ConversationSummary[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]),
        [message, setMessage] = useState(""),
        [detail, setDetail] = useState<JobDetail | null>(null);
    const [listMessage, setListMessage] = useState("");
    const returnFocus = useRef<HTMLElement | null>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detailRevision, setDetailRevision] = useState(0);
    const requestedId = useRef<string | null>(null);
    const listLoading = useRef(false);
    const selectJob = useCallback((id: string | null) => {
        requestedId.current = id;
        setSelectedId(id);
        setDetail(null);
        setMessage(id ? "正在读取任务结果，不会重新提交AI。" : "");
        setDetailRevision(n => n + 1);
    }, []);
    useEffect(() => {
        const fromUrl = () => {
            const id = new URLSearchParams(window.location.search).get("job");
            selectJob(id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null);
        };
        const start = setTimeout(fromUrl, 0);
        window.addEventListener("popstate", fromUrl);
        return () => { clearTimeout(start); window.removeEventListener("popstate", fromUrl); };
    }, [selectJob]);
    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const load = async () => {
            try {
                const job = await apiClient.get<JobDetail>(`/api/ai/jobs/${selectedId}?restore=1`, { signal: controller.signal, timeout: 20000 });
                if (cancelled || requestedId.current !== selectedId) return;
                setDetail(job);
                setMessage("");
                if (["pending", "running"].includes(job.state)) timer = setTimeout(() => void load(), 3000);
            } catch (error) {
                if (!cancelled && requestedId.current === selectedId) setMessage(readFailureMessage(error));
            }
        };
        void load();
        return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
    }, [selectedId, detailRevision]);
    const reload = useCallback(async (signal?: AbortSignal) => {
        if (listLoading.current || signal?.aborted) return;
        listLoading.current = true;
        try {
            const conversations = await apiClient.get<{conversations:ConversationSummary[]}>("/api/ai/conversations", {signal, timeout:20000});
            if (signal?.aborted) return;
            setConversations(conversations.conversations);
            const jobs = await apiClient.get<{jobs:Job[]}>("/api/ai/jobs", {signal, timeout:20000});
            if (signal?.aborted) return;
            setJobs(jobs.jobs);
            setListMessage("");
        } catch (error) {
            if (!signal?.aborted) setListMessage(readFailureMessage(error));
        } finally { listLoading.current = false; }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            await reload(controller.signal);
            if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
        };
        timer = setTimeout(() => void poll(), 0);
        return () => { controller.abort(); clearTimeout(timer); };
    }, [reload]);
    const closeDetail = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("job");
        window.history.replaceState(window.history.state, "", url);
        selectJob(null);
    };
    const view = (id: string, opener: HTMLElement) => {
        returnFocus.current = opener;
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
        const url = new URL(window.location.href);
        url.searchParams.set("job", id);
        window.history.replaceState(window.history.state, "", url);
        selectJob(id);
    };
    return (
        <main className="max-w-4xl mx-auto p-5 space-y-5">
            <Link href="/">返回首页</Link>
            <Link href="/solving-records" className="underline">查看长期解题记录</Link>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">我的AI任务</h1>
            <p>
                服务端确认受理后，刷新或关闭页面不影响后台任务。解题会话、直接解题和重新解答长期保留；绘图、举一反三等临时任务仅保留24小时，可复制当前任务链接取回结果，无需重新生成；不自动恢复编辑页、未保存草稿或当前显示步骤。同题会话持久保存，等待补充信息时不会占用队列。取消不能保证撤回上游已受理请求。
            </p>
            <p role="status">{listMessage}</p>
            <section className="space-y-3"><h2 className="text-lg font-semibold">解题会话</h2>{conversations.map(c=><article key={c.id} className="border rounded p-4"><Link className="underline" href={`/ai-dialogue/${c.id}`}>{dialogueLabels[c.state] || c.state} · 已完成{c.roundsUsed}/{c.roundLimit}轮</Link><p className="text-sm text-muted-foreground">更新于{new Date(c.updatedAt).toLocaleString()}</p></article>)}{!conversations.length && <p>还没有解题会话，从错题本添加题目即可开始。</p>}</section>
            <h2 className="text-lg font-semibold">短任务（含辅助线作图）</h2>
            {jobs.map((j) => (
                <article key={j.id} className="border p-4 rounded space-y-2">
                    <div>
                        {j.kind} · {labels[j.state] || j.state} · 尝试
                        {j.attempts}次
                    </div>
                    <small>
                        {new Date(j.createdAt).toLocaleString()} {j.errorCode}
                    </small>
                    <div className="flex gap-4">
                        <button aria-haspopup="dialog" onClick={event => view(j.id, event.currentTarget)}>
                            详情/取回结果
                        </button>
                        {["pending", "running"].includes(j.state) && (
                            <button
                                onClick={async () => {
                                    try {
                                        await apiClient.delete(
                                            `/api/ai/jobs/${j.id}`,
                                        );
                                        void reload();
                                    } catch {
                                        setListMessage(
                                            "取消失败，请刷新任务状态后重试。",
                                        );
                                    }
                                }}
                            >
                                取消任务
                            </button>
                        )}
                    </div>
                </article>
            ))}
            <Dialog open={!!selectedId} onOpenChange={open => { if (!open) closeDetail(); }}>
                <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden p-0 gap-0"
                    onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; (target?.isConnected ? target : heading.current)?.focus({preventScroll:true}); }}>
                    <DialogHeader className="shrink-0 border-b p-4 pr-12 text-left">
                        <DialogTitle>任务详情</DialogTitle>
                        <DialogDescription>查看已受理任务与已有结果。关闭弹窗只返回列表，不取消后台任务，也不重新提交AI；解题记录长期保留，绘图和举一反三等临时结果保留24小时。</DialogDescription>
                    </DialogHeader>
                    <div data-task-detail-scroll className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 space-y-3">
                        {message && <p role="status">{message}</p>}
                        {detail?.errorCode === "AI_DRAWING_UNSUPPORTED" && <p role="alert">{diagnosticMessage("DRAWING_UNSUPPORTED")}</p>}
                        {detail && <>
                    <p className="font-medium">{detail.kind} · {labels[detail.state] || detail.state}</p>
                    <pre className="whitespace-pre-wrap break-words text-sm overflow-auto">
                        {JSON.stringify(
                            {
                                state: detail.state,
                                attempts: detail.attemptsLog,
                                result: detail.state === "success" && detail.result && ["construction","image_edit"].includes(detail.kind)?"见下方作图预览":detail.result,
                                error: detail.errorCode,
                            },
                            null,
                            2,
                        )}
                    </pre>
                    {detail.state === "success" && ["construction","image_edit"].includes(detail.kind) && <DrawingResultPreview key={detail.id} result={detail.result} originalImage={originalImage(detail.input)} input={detail.input}/>}
                    {detail.state === "success" &&
                        detail.kind === "analyze" && (
                            <Link
                                className="underline"
                                href={
                                    detail.input?.subjectId
                                        ? `/notebooks/${encodeURIComponent(detail.input.subjectId)}/add?job=${encodeURIComponent(detail.id)}`
                                        : `/?job=${encodeURIComponent(detail.id)}`
                                }
                            >
                                取回到编辑器，核对后保存
                            </Link>
                        )}
                    {detail.state === "success" &&
                        detail.kind === "reanswer" &&
                        detail.input?.questionText && (
                            <p>
                                重解结果可从上方复制到原题编辑器；任务不会自动覆盖已保存题目。
                            </p>
                        )}
                    {detail.state === "unknown" && (
                        <p>
                            请先检查供应商的请求/计费记录，再决定是否回原页面重新提交。这里不会自动重新收费。
                        </p>
                    )}
                        </>}
                    </div>
                    <DialogFooter className="shrink-0 border-t p-4 gap-2">
                        <Button variant="outline" className="whitespace-normal h-auto min-h-9" onClick={() => { if (selectedId) selectJob(selectedId); }}>重新读取本次任务（不重新生成）</Button>
                        <DialogClose asChild><Button>关闭详情</Button></DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}