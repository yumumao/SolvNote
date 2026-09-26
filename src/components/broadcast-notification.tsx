"use client";
import Link from "next/link";
import {useSession} from "next-auth/react";
import {Bell} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger} from "@/components/ui/dialog";
import {useLanguage} from "@/contexts/LanguageContext";
import {useNotices} from "@/components/announcements/use-notices";
import {NoticePanel} from "@/components/announcements/notice-panel";
function AccountNotices() {
    const {language} = useLanguage(), en = language === "en", feed = useNotices();
    const count = feed.data?.unreadCount ?? 0;
    return <Dialog onOpenChange={open => {if (open) feed.refresh();}}>
        <DialogTrigger asChild><Button variant="ghost" size="icon" className="relative rounded-full" aria-label={en ? "Announcements" : "公告通知"}>
            <Bell className="h-5 w-5" aria-hidden="true"/>
            {count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground" aria-label={en ? `${count} unread` : `${count}条未读`}>{count > 99 ? "99+" : count}</span>}
            {feed.error && <span className="absolute right-0 top-0 text-destructive" aria-label={en ? "Notices unavailable" : "公告暂不可用"}>!</span>}
        </Button></DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto max-w-xl">
            <DialogHeader><DialogTitle>{en ? "Announcements" : "公告通知"}</DialogTitle>
                <DialogDescription>{en ? "Site notices and account-specific read status" : "站内公告与当前账号的已阅状态"}</DialogDescription></DialogHeader>
            <NoticePanel feed={feed}/>
            <Link className="text-sm underline" href="/announcements">{en ? "Open notice center" : "打开公告中心"}</Link>
        </DialogContent>
    </Dialog>;
}
export function BroadcastNotification() {
    const {data: session} = useSession();
    // Remount on account changes: never display another account's cached receipts.
    return session?.user?.id ? <AccountNotices key={session.user.id}/> : null;
}
