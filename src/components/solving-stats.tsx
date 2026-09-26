"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {apiClient} from "@/lib/api-client";
import {useLanguage} from "@/contexts/LanguageContext";
import {Button} from "@/components/ui/button";
import type {SolvingStats as Stats} from "@/lib/solving-records/types";

export function SolvingStats() {
    const {language} = useLanguage();
    const en = language === "en";
    const [data,setData] = useState<Stats|null>(null);
    const [error,setError] = useState(false);
    const [revision,setRevision] = useState(0);
    useEffect(()=>{
        let stopped = false;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const load = async () => {
            try {
                const result = await apiClient.get<Stats>("/api/stats/solving",{signal:controller.signal});
                if (!stopped) {setData(result);setError(false);}
            } catch {if (!stopped) setError(true);}
            finally {if (!stopped) timer = setTimeout(()=>void load(),10000);}
        };
        void load();
        return ()=>{stopped=true;controller.abort();clearTimeout(timer);};
    },[revision]);
    const cards: [keyof Omit<Stats,"months">,string][] = en ? [["total","Solving records"],["completed","Completed"],["awaiting","Needs input"],["processing","Processing"],["failed","Incomplete / check needed"],["cancelled","Cancelled"],["aiCalls","Recorded AI attempts"]] : [["total","解题记录数"],["completed","已完成"],["awaiting","待补充"],["processing","处理中"],["failed","未完成／需核查"],["cancelled","已取消"],["aiCalls","已记录解题AI调用"]];
    return <section className="space-y-6" aria-label={en ? "Solving statistics" : "解题统计"}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{en ? "Solving overview" : "解题概览"}</h2><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>setRevision(n=>n+1)}>{en ? "Refresh" : "刷新"}</Button><Button asChild size="sm"><Link href="/solving-records">{en ? "View records" : "查看解题记录"}</Link></Button></div></div>
        <p className="text-sm text-muted-foreground">{en ? "A conversation counts once, regardless of follow-ups. Completed does not mean correct. Review practice and notebook entries are counted separately." : "一段会话只计一条，追问不重复累计。已完成不代表答案正确；复习练习与错题收录另行统计。"}</p>
        {error && <p role="alert">{en ? "Unable to load. Refresh after checking your login and connection; displayed data may be outdated." : "无法加载，请检查登录状态和网络后刷新；已有数据可能不是最新状态。"}</p>}
        {!data && !error && <p role="status">{en ? "Loading…" : "正在加载统计…"}</p>}
        {data && <>
            <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{cards.map(([key,label])=><div key={key} className="rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-3xl font-semibold mt-2 tabular-nums">{data[key]}</dd></div>)}</dl>
            <p className="text-xs text-muted-foreground">{en ? "AI attempts include failures and retries recorded for retained solves, not all historical requests, charges or tokens. No accuracy rate is inferred." : "AI调用仅统计当前保留的解题调用日志，包含失败与切换尝试，不代表历史总调用、费用或token用量，不据此推算正确率。"}</p>
            <div className="rounded-xl border p-4 space-y-4"><h3 className="font-semibold">{en ? "New records in the last 6 months (UTC+8)" : "近6个月新增解题记录（北京时间）"}</h3>
                <ul className="space-y-3">{data.months.map(month=>({ ...month,percent:Math.round(month.count/Math.max(1,...data.months.map(m=>m.count))*100)})).map(month=><li key={month.month} className="grid grid-cols-[5rem_1fr_4rem] gap-3 items-center text-sm"><span>{month.month}</span><div className="h-3 bg-muted rounded-full overflow-hidden" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{width:`${month.percent}%`}}/></div><span className="text-right">{month.count}{en ? " records" : "条"}</span></li>)}</ul>
            </div>
        </>}
    </section>;
}
