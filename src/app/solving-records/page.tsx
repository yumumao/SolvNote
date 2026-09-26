"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {BookOpen, RefreshCw, History} from "lucide-react";
import {apiClient} from "@/lib/api-client";
import {useLanguage} from "@/contexts/LanguageContext";
import {Button} from "@/components/ui/button";
import {BackButton} from "@/components/ui/back-button";
import {statusLabels, kindLabels, type RecordPage, type RecordStatus} from "@/lib/solving-records/types";

const englishStatus: Record<RecordStatus,string> = {processing:"Processing", completed:"Completed", awaiting:"Needs input", failed:"Incomplete / check needed", cancelled:"Cancelled"};
const englishKind = {conversation:"Question conversation", analyze:"Direct solve", reanswer:"Reanswer"};

function RecordList({status,cursor,onNext,onPrevious,page}: {status:string;cursor:string|null;onNext:(cursor:string)=>void;onPrevious:()=>void;page:number}) {
    const {language} = useLanguage();
    const en = language === "en";
    const [data,setData] = useState<RecordPage|null>(null);
    const [error,setError] = useState(false);
    const [loading,setLoading] = useState(true);
    const [revision,setRevision] = useState(0);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        const load = async () => {
            const params = new URLSearchParams({status});
            if (cursor) params.set("cursor",cursor);
            try {
                const result = await apiClient.get<RecordPage>(`/api/solving-records?${params}`, {signal:controller.signal});
                if (!stopped) { setData(result); setError(false); }
            } catch { if (!stopped) setError(true); }
            finally {
                if (!stopped) { setLoading(false); timer = setTimeout(() => void load(),3000); }
            }
        };
        void load();
        return () => { stopped = true; controller.abort(); clearTimeout(timer); };
    },[status,cursor,revision]);
    const labels = en ? englishStatus : statusLabels;
    const date = (value:string) => new Date(value).toLocaleString(en ? "en-GB" : "zh-CN", {timeZone:"Asia/Shanghai",hour12:false});
    return <section className="space-y-4" aria-label={en ? "Record list" : "解题记录列表"}>
        <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{en ? "Refreshes every 3 seconds · times in UTC+8" : "每3秒自动刷新 · 时间为北京时间"}</p>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => {setLoading(true); setRevision(n=>n+1);}}><RefreshCw className="h-4 w-4" aria-hidden="true"/>{en ? "Refresh" : "刷新"}</Button>
        </div>
        {loading && <p role="status">{en ? "Loading records…" : "正在加载记录…"}</p>}
        {error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">{en ? "Unable to load. Check your login or network and refresh. Existing data may be outdated; no AI task was resubmitted." : "无法加载，请检查登录状态或网络后刷新。已有列表可能不是最新状态，不会重新提交AI任务。"}</p>}
        {data?.records.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
            <History className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true"/>
            <h2 className="font-semibold">{en ? "No solving records" : "暂无解题记录"}</h2>
            <p className="text-sm text-muted-foreground">{en ? "No records match this filter. Start a solve to create a record automatically." : "当前筛选下还没有记录。开始解题后，系统受理即自动记录。"}</p>
            <Button asChild><Link href="/">{en ? "Start solving" : "开始解题"}</Link></Button>
        </div>}
        <ul className="space-y-3">
            {data?.records.map(record => <li key={record.key} className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap gap-2 items-center text-xs">
                    <span className="rounded-md bg-muted px-2 py-1">{(en ? englishKind : kindLabels)[record.kind]}</span>
                    <span className="rounded-md border px-2 py-1 font-medium">{labels[record.status]}</span>
                    {record.roundsUsed !== undefined && <span className="text-muted-foreground">{en ? `${record.roundsUsed} dialogue rounds` : `已用${record.roundsUsed}轮问答`}</span>}
                </div>
                <Link className="block font-medium text-primary underline-offset-4 hover:underline break-words focus-visible:outline-2" href={record.kind === "conversation" ? `/ai-dialogue/${encodeURIComponent(record.id)}` : `/ai-tasks?job=${encodeURIComponent(record.id)}`}>{record.title}</Link>
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>{en ? "Created: " : "开始："}<time dateTime={record.createdAt}>{date(record.createdAt)}</time></span>
                    <span>{en ? "Updated: " : "更新："}<time dateTime={record.updatedAt}>{date(record.updatedAt)}</time></span>
                </div>
            </li>)}
        </ul>
        <nav className="flex items-center justify-center gap-4" aria-label={en ? "Pagination" : "记录分页"}>
            <Button variant="outline" disabled={page === 1 || loading} onClick={onPrevious}>{en ? "Previous" : "上一页"}</Button>
            <span className="text-sm">{en ? `Page ${page}` : `第${page}页`}</span>
            <Button variant="outline" disabled={!data?.nextCursor || loading} onClick={() => data?.nextCursor && onNext(data.nextCursor)}>{en ? "Next" : "下一页"}</Button>
        </nav>
    </section>;
}

export default function RecordsPage() {
    const {language} = useLanguage();
    const en = language === "en";
    const [status,setStatus] = useState("all");
    const [cursors,setCursors] = useState<(string|null)[]>([null]);
    const cursor = cursors[cursors.length-1];
    return <main className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
        <header className="flex items-start gap-3">
            <BackButton fallbackUrl="/"/>
            <div className="space-y-2 min-w-0"><h1 className="text-2xl sm:text-3xl font-bold">{en ? "Solving records" : "解题记录"}</h1>
                <p className="text-sm text-muted-foreground">{en ? "Recorded on acceptance. Follow-ups stay in one conversation; saving to a notebook is a separate choice." : "受理即记录，同题追问归入同一会话；是否存入错题本，由你另行决定。"}</p>
            </div>
        </header>
        <div className="rounded-lg bg-muted/50 border p-4 text-sm space-y-1">
            <p>{en ? "Conversations and direct solves are retained long-term. Deleted historical tasks cannot be recovered. Drawing and practice tasks are not included here." : "会话与直接解题长期保留；过去已清理的任务无法找回。绘图、举一反三任务不计入本栏。"}</p>
            <p className="text-muted-foreground">{en ? "Completed does not mean correct. Review the answer before saving. Notebook JSON exports do not back up these records." : "已完成不代表答案正确，请核对后再收录。错题本JSON导出不包含这些记录。"}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><label htmlFor="record-status" className="text-sm font-medium">{en ? "Record status" : "记录状态"}</label>
                <select id="record-status" value={status} onChange={e=>{setStatus(e.target.value);setCursors([null]);}} className="rounded-md border bg-background p-2 text-sm">
                    <option value="all">{en ? "All" : "全部"}</option>
                    {Object.entries(en ? englishStatus : statusLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}
                </select>
            </div>
            <Button variant="outline" asChild><Link href="/"><BookOpen className="h-4 w-4" aria-hidden="true"/>{en ? "New solve" : "新建解题"}</Link></Button>
        </div>
        <RecordList key={`${status}:${cursor}`} status={status} cursor={cursor} page={cursors.length} onNext={c=>setCursors(old=>[...old,c])} onPrevious={()=>setCursors(old=>old.slice(0,-1))}/>
    </main>;
}
