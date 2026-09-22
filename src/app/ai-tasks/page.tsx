"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
type JobDetail = {
    id: string;
    kind: string;
    state: string;
    attemptsLog?: unknown;
    result?: unknown;
    errorCode?: string;
    input?: { subjectId?: string; questionText?: string };
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
export default function AITasks() {
    const [jobs, setJobs] = useState<Job[]>([]),
        [message, setMessage] = useState(""),
        [detail, setDetail] = useState<JobDetail | null>(null);
    const reload = useCallback(async () => {
        try {
            setJobs(
                (await apiClient.get<{ jobs: Job[] }>("/api/ai/jobs")).jobs,
            );
        } catch {
            setMessage("无法加载，请先登录。");
        }
    }, []);
    useEffect(() => {
        const start = setTimeout(() => void reload(), 0);
        const timer = setInterval(reload, 3000);
        return () => {
            clearTimeout(start);
            clearInterval(timer);
        };
    }, [reload]);
    const view = async (id: string) => {
        try {
            setDetail(
                await apiClient.get<JobDetail>(`/api/ai/jobs/${id}?restore=1`),
            );
        } catch {
            setMessage("任务不存在或已过期。");
        }
    };
    return (
        <main className="max-w-4xl mx-auto p-5 space-y-5">
            <Link href="/">返回首页</Link>
            <h1 className="text-2xl font-bold">我的AI任务</h1>
            <p>
                刷新或关闭页面不影响服务端任务。仅保留24小时，请及时取回结果。取消不能保证撤回上游已受理请求。
            </p>
            <p role="status">{message}</p>
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
                        <button onClick={() => view(j.id)}>
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
                                        setMessage(
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
            {detail && (
                <section className="border rounded p-4 space-y-3">
                    <h2>任务详情</h2>
                    <pre className="whitespace-pre-wrap text-sm overflow-auto">
                        {JSON.stringify(
                            {
                                state: detail.state,
                                attempts: detail.attemptsLog,
                                result: detail.result,
                                error: detail.errorCode,
                            },
                            null,
                            2,
                        )}
                    </pre>
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
                </section>
            )}
        </main>
    );
}
