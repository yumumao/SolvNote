"use client";
import {useLanguage} from "@/contexts/LanguageContext";
import {Button} from "@/components/ui/button";
import {NoticeCard} from "./notice-card";
import type {useNotices} from "./use-notices";
export function NoticePanel({feed}: {feed: ReturnType<typeof useNotices>}) {
    const {language} = useLanguage(), en = language === "en";
    return <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
            <Button variant={feed.view === "inbox" ? "default" : "outline"} onClick={() => feed.changeView("inbox")}>{en ? "Notices" : "通知列表"}</Button>
            <Button variant={feed.view === "history" ? "default" : "outline"} onClick={() => feed.changeView("history")}>{en ? "History" : "历史公告"}</Button>
            <Button variant="ghost" onClick={feed.refresh}>{en ? "Refresh" : "刷新"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{en ? "Opening this list does not mark notices as read. Confirm each notice explicitly. Read-and-hide only affects your account." : "打开列表不会标为已阅，请逐条确认。读后隐藏仅影响你的账号，后台仍保留公告。"}</p>
        {feed.error && <p role="alert" className="text-sm text-destructive">{en ? "Unable to load or save notices. Please refresh and retry." : "公告加载或保存失败，请刷新后重试。"}</p>}
        {!feed.data && !feed.error && <p role="status">{en ? "Loading…" : "加载中…"}</p>}
        {feed.data && <>
            {feed.data.items.length === 0 && <p>{en ? "No notices on this page." : "本页暂无公告。"}</p>}
            <div className="space-y-3">{feed.data.items.map(notice => <NoticeCard key={notice.id} notice={notice} busy={feed.busy !== null} onRead={() => void feed.read(notice.id)}/>)}</div>
            <div className="flex flex-wrap gap-3 items-center text-sm">
                <Button variant="outline" disabled={feed.page <= 1} onClick={() => feed.changePage(feed.page - 1)}>{en ? "Previous" : "上一页"}</Button>
                <span>{en ? `Page ${feed.page} · ${feed.data.total} notices` : `第${feed.page}页 · 共${feed.data.total}条`}</span>
                <Button variant="outline" disabled={feed.page * feed.data.pageSize >= feed.data.total} onClick={() => feed.changePage(feed.page + 1)}>{en ? "Next" : "下一页"}</Button>
            </div>
        </>}
    </div>;
}
