"use client";
import Link from "next/link";
import {useSession} from "next-auth/react";
import {useLanguage} from "@/contexts/LanguageContext";
import {useNotices} from "@/components/announcements/use-notices";
import {NoticePanel} from "@/components/announcements/notice-panel";
function AccountNoticeCenter() {
    const {language} = useLanguage(), en = language === "en", feed = useNotices();
    return <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        <Link href="/" className="underline text-sm">{en ? "Back to home" : "返回首页"}</Link>
        <h1 className="text-2xl font-bold">{en ? "Notice center" : "公告中心"}</h1>
        <NoticePanel feed={feed}/>
    </main>;
}
export default function NoticeCenter() {
    const {data: session} = useSession();
    return session?.user?.id ? <AccountNoticeCenter key={session.user.id}/> : null;
}
