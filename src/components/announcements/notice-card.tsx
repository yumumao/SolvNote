"use client";
import Link from "next/link";
import {useLanguage} from "@/contexts/LanguageContext";
import {Button} from "@/components/ui/button";
import {safeNoticeHref, type Announcement} from "@/lib/announcements/schema";
export function NoticeCard({notice, onRead, busy = false}: {notice: Announcement; onRead?: () => void; busy?: boolean}) {
    const {language} = useLanguage(), en = language === "en";
    const title = en && notice.titleEn ? notice.titleEn : notice.titleZh;
    const body = en && notice.bodyEn ? notice.bodyEn : notice.bodyZh;
    return <article className="rounded-lg border bg-muted/20 p-4 space-y-3 min-w-0 break-words">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {notice.pinned && <span>{en ? "Pinned" : "置顶"}</span>}
            {notice.readPolicy === "persistent" && <span>{en ? "Persistent" : "常驻"}</span>}
            {notice.readPolicy === "hide" && <span>{en ? "Hidden for you after acknowledgement" : "确认已阅后仅对你隐藏"}</span>}
            <span>{notice.readAt ? (en ? "Read" : "已阅") : (en ? "Unread" : "未读")}</span>
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{body}</p>
        <div className="flex flex-wrap gap-3 items-center">
            {notice.href && safeNoticeHref(notice.href) && <Link href={notice.href} className="text-sm underline text-primary">{en ? "Open related page" : "打开相关页面"}</Link>}
            {!notice.readAt && onRead && <Button size="sm" variant="outline" disabled={busy} onClick={onRead}>
                {busy ? (en ? "Saving…" : "保存中…") : notice.readPolicy === "hide" ? (en ? "Read and hide for me" : "已阅，对我隐藏") : (en ? "Mark as read" : "确认已阅")}
            </Button>}
        </div>
    </article>;
}
