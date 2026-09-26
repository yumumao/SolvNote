"use client";
import {useCallback, useEffect, useState} from "react";
import {apiClient} from "@/lib/api-client";
import type {AnnouncementList, NoticeView} from "@/lib/announcements/schema";
export function useNotices() {
    const [view, setView] = useState<NoticeView>("inbox"), [page, setPage] = useState(1);
    const [data, setData] = useState<AnnouncementList | null>(null), [error, setError] = useState(false);
    const [revision, setRevision] = useState(0), [busy, setBusy] = useState<string | null>(null);
    const refresh = useCallback(() => setRevision(r => r + 1), []);
    useEffect(() => {
        let live = true, timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController();
        async function load() {
            try {
                const result = await apiClient.get<AnnouncementList>(`/api/announcements?view=${view}&page=${page}`, {signal: controller.signal, cache: "no-store"});
                if (live) { setData(result); setError(false); }
            } catch { if (live) {setError(true); setData(null);} }
            finally { if (live) timer = setTimeout(load, 30000); }
        }
        void load();
        return () => { live = false; controller.abort(); clearTimeout(timer); };
    }, [view, page, revision]);
    async function read(id: string) {
        if (busy) return;
        setBusy(id);
        try { await apiClient.post(`/api/announcements/${encodeURIComponent(id)}/read`, {}); refresh(); }
        catch { setError(true); }
        finally { setBusy(null); }
    }
    return {view, page, data, error, busy, refresh, read,
        changeView: (v: NoticeView) => {setView(v); setPage(1); setData(null);},
        changePage: (p: number) => {setPage(p); setData(null);},
    };
}
