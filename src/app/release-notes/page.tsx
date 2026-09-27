"use client";
import Link from "next/link";
import {BackButton} from "@/components/ui/back-button";
import {useLanguage} from "@/contexts/LanguageContext";
import {APP_REPOSITORY,APP_UPSTREAM} from "@/lib/app-info";
import {version} from "../../../package.json";

export default function ReleaseNotes() {
    const {language} = useLanguage();
    const en = language === "en";
    const notes = en ? [
        ["Announcement management", "Administrators manage drafts, publication, hiding, archiving, pin order and optional time windows. Confirming a notice as read affects only your account: ordinary notices move to history, read-and-hide notices disappear for you, and persistent notices stay without an unread badge. Opening the list does not mark it as read. Editing or republishing preserves read status. List actions support pin/unpin and hide/republish; confirmed permanent deletion removes a notice and its read receipts and cannot be undone."],
        ["Solving records", "Dedicated home navigation, 20-record cursor pagination and status filters, refreshing every 3 seconds. Conversations, direct solves and reanswers are retained long-term. Follow-ups count as one conversation; drawings and practice-generation tasks are excluded."],
        ["Statistics", "Separate solving, notebook and review-practice statistics. Counts cover all stored records, not just the first page. Six-month creation trend uses UTC+8. Completed does not mean correct; recorded AI attempts are not billing totals."],
        ["Identity and settings", "SolvNote site title and original book/checkmark icon; refreshed notices, precise prompt scope, backup and destructive-action descriptions, and links to this repository. Upstream credit retained."],
        ["Retention and upgrades", "Existing direct solves still present in the database remain readable, even if their old expiry date has passed. Already purged data cannot be recovered. Expired queued tasks are not automatically resubmitted. Announcement management requires an additive migration for two tables together with the matching Prisma client and application build; existing learning-data tables are not rebuilt."],
        ["Backup scope", "Notebook JSON exports do not include solving conversations, AI tasks, announcements, read receipts or AI credentials. For full recovery, stop application writes and preserve the database, configuration directory and original secret environment variables together, including the encryption master key. Long-term storage is not a backup."],
        ["Publication", "This page describes the program in this instance. A matching GitHub release or container image may not have been published. Check repository history and image workflow before upgrading another deployment."],
    ] : [
        ["公告管理", "管理员可管理草稿、发布、隐藏、归档、置顶排序及可选有效期。显式确认已阅只影响本人：普通公告进入历史，读后隐藏不再展示，常驻公告仍保留但不再计未读。打开列表不标已阅，编辑或重新发布保留已阅状态。列表可直接置顶/取消置顶、隐藏/恢复发布；永久删除需确认，并清除该公告及已阅记录，无法撤销。"],
        ["解题记录", "首页独立入口，20条游标分页、状态筛选、每3秒刷新。解题会话、直接解题及重新解答长期保留，同题追问只计一条会话，不纳入绘图和举一反三任务。"],
        ["统计中心", "分开统计解题、错题收录与复习练习，覆盖全部已保存记录，不截取首页列表。近6个月按北京时间统计新增记录。已完成不代表答案正确，已记录AI调用不等于账单总量。"],
        ["站点与设置", "更新解迹·SolvNote站点标题、原创书本勾选图标、公告、提示词适用范围、备份和危险操作说明。关于链接指向本仓库，保留上游署名。"],
        ["保留与升级", "数据库中仍存在的旧式解题即使超过原过期时间也可读取；过去已清理的数据无法恢复。过期排队任务不会自动重发。公告管理需要增量迁移两张表，并与新版Prisma客户端及程序一同升级，不重建学习数据表。"],
        ["备份范围", "错题本JSON导出不包含解题会话、AI任务、公告、已阅状态或AI凭据。完整恢复需先停止应用写入，配对保存数据库、配置目录和原秘密环境变量，尤其保留加密主钥。长期保存不等于备份。"],
        ["发布状态", "本页说明当前实例程序的改动，不代表对应GitHub发行包或容器镜像已经发布。升级其他部署前请核对仓库历史和镜像工作流。"],
    ];
    return <main className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div className="flex gap-3 items-start"><BackButton fallbackUrl="/"/><div><h1 className="text-2xl font-bold">{en ? "Version notes" : "版本说明"}</h1><p className="text-muted-foreground">v{version} · 2026-09-27</p></div></div>
        {notes.map(([title,body])=><section key={title} className="rounded-xl border p-5 space-y-2"><h2 className="font-semibold">{title}</h2><p className="text-sm leading-relaxed text-muted-foreground">{body}</p></section>)}
        <footer className="flex gap-4 flex-wrap text-sm"><Link href="/solving-records" className="underline">{en ? "Solving records" : "解题记录"}</Link><a className="underline" href={APP_REPOSITORY} target="_blank" rel="noopener noreferrer">SolvNote GitHub</a><a className="underline" href={APP_UPSTREAM} target="_blank" rel="noopener noreferrer">{en ? "Upstream · wttwins" : "上游 · wttwins"}</a></footer>
    </main>;
}
