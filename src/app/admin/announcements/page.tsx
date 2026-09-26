"use client";
import Link from "next/link";
import {useEffect, useRef, useState} from "react";
import {useSession} from "next-auth/react";
import {useLanguage} from "@/contexts/LanguageContext";
import {apiClient, ApiError} from "@/lib/api-client";
import {Button} from "@/components/ui/button";
import {NoticeCard} from "@/components/announcements/notice-card";
import {announcementInput, statuses, policies, type Announcement, type AnnouncementInput, type AnnouncementList} from "@/lib/announcements/schema";
const blank: AnnouncementInput = {titleZh: "", bodyZh: "", titleEn: "", bodyEn: "", href: "", status: "draft", pinned: false, pinOrder: 0, readPolicy: "keep", startsAt: null, endsAt: null};
const statusZh = {draft: "草稿", published: "已发布", hidden: "暂时隐藏", archived: "已归档"};
const policyZh = {keep: "读后保留到历史", hide: "读后仅对本人隐藏", persistent: "常驻通知列表"};
const policyEn = {keep: "Keep in history", hide: "Hide for reader", persistent: "Persistent in inbox"};
const control = "w-full rounded-md border bg-background p-2 text-sm";
function localTime(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function inputTime(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function inputFrom(item: Announcement): AnnouncementInput {
    return {titleZh: item.titleZh, bodyZh: item.bodyZh, titleEn: item.titleEn, bodyEn: item.bodyEn, href: item.href,
        status: item.status, pinned: item.pinned, pinOrder: item.pinOrder, readPolicy: item.readPolicy, startsAt: item.startsAt, endsAt: item.endsAt};
}
type DirectAction = "pin" | "unpin" | "hide" | "publish" | "delete";
function AdminNotices() {
    const {language} = useLanguage(), en = language === "en";
    const [data, setData] = useState<AnnouncementList | null>(null), [status, setStatus] = useState("all"), [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0), [error, setError] = useState(""), [message, setMessage] = useState("");
    const [draft, setDraft] = useState<AnnouncementInput | null>(null), [editing, setEditing] = useState<Announcement | null>(null), [saving, setSaving] = useState(false), [actionId, setActionId] = useState("");
    const actionBusy = useRef(false);
    useEffect(() => {
        let live = true; const controller = new AbortController();
        void apiClient.get<AnnouncementList>(`/api/admin/announcements?status=${status}&page=${page}`, {signal: controller.signal, cache: "no-store"})
            .then(result => {
                if (!live) return;
                const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
                if (page > lastPage) {setData(null); setPage(lastPage);}
                else setData(result);
            }).catch(() => {if (live) setError(en ? "Unable to load notices." : "无法加载公告。");});
        return () => {live = false; controller.abort();};
    }, [status, page, revision, en]);
    const update = <K extends keyof AnnouncementInput>(key: K, value: AnnouncementInput[K]) => setDraft(d => d ? {...d, [key]: value} : d);
    function edit(item: Announcement | null) {
        setEditing(item); setError(""); setMessage("");
        setDraft(item ? inputFrom(item) : {...blank});
    }
    async function directAction(item: Announcement, action: DirectAction) {
        if (actionBusy.current || draft || saving) return;
        const title = en && item.titleEn ? item.titleEn : item.titleZh;
        if (action === "delete" && !window.confirm(en
            ? `Permanently delete: ${title}?\nThe notice and its read receipts will be deleted for all accounts. This cannot be undone. Use Hide to retain it.`
            : `确定永久删除公告：${title}？\n将删除这条公告及所有账号对应的已阅记录，无法撤销。如需保留，请使用隐藏。`)) return;
        actionBusy.current = true;
        setActionId(`${item.id}:${action}`); setError(""); setMessage("");
        try {
            if (action === "delete") await apiClient.delete(`/api/admin/announcements/${item.id}`, {body: JSON.stringify({revision: item.revision})});
            else await apiClient.patch(`/api/admin/announcements/${item.id}`, {action, revision: item.revision});
            setData(null); setRevision(r => r + 1);
            setMessage(action === "delete"
                ? (en ? "Deleted permanently." : "已永久删除。")
                : (en ? "Updated. Existing read receipts were preserved." : "已更新，用户已有的已阅状态保持不变。"));
        } catch (e) {
            setError(e instanceof ApiError && e.status === 409
                ? (en ? "The notice changed in another session. Refresh the list and retry." : "公告已在其他会话中发生变化，请刷新列表后重试。")
                : (en ? "Action failed. Refresh the list and retry." : "操作失败，请刷新列表后重试。"));
        } finally {actionBusy.current = false; setActionId("");}
    }
    async function save() {
        if (!draft || saving) return;
        if (!announcementInput.safeParse(draft).success) {setError(en ? "Check required text, same-site link and time range." : "请检查必填正文、站内链接和起止时间。"); return;}
        setSaving(true); setError(""); setMessage("");
        try {
            if (editing) await apiClient.put(`/api/admin/announcements/${editing.id}`, {...draft, revision: editing.revision});
            else await apiClient.post("/api/admin/announcements", draft);
            setDraft(null); setEditing(null); setData(null); setRevision(r => r + 1);
            setMessage(en ? "Saved. User read receipts were preserved." : "已保存，用户已有的已阅状态保持不变。");
        } catch (e) {
            setError(e instanceof ApiError && e.status === 409
                ? (en ? "Another administrator changed this notice. Copy your draft, close the editor, refresh and reopen it." : "公告已被其他管理员修改。请先复制保留草稿，再关闭编辑、刷新列表并重新打开。")
                : (en ? "Save failed. Your draft is retained; check access and retry." : "保存失败，草稿已保留。请检查权限后重试。"));
        } finally {setSaving(false);}
    }
    return <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        <Link className="underline text-sm" href="/admin">{en ? "Back to admin" : "返回管理后台"}</Link>
        <h1 className="text-2xl font-bold">{en ? "Announcement management" : "公告管理"}</h1>
        <p className="text-sm text-muted-foreground">{en ? "Site-wide notices only, visible to active signed-in accounts. Status, pinning and read policy are independent. Hiding or republishing preserves read receipts. To notify everyone again, create a new notice." : "仅站内通知，面向本站所有已登录且启用的账号。发布状态、置顶和阅读策略独立；隐藏或重新发布不会清空已阅状态。需要再次通知所有人时，请新建公告。"}</p>
        <p className="text-xs text-muted-foreground">{en ? "Quick actions are available below. Delete is permanent and also removes this notice's read receipts; use Hide or Archive when you may need the record later." : "列表下方提供快捷操作。删除不可恢复，并会删除这条公告的已阅记录；如需保留记录，请优先使用隐藏或归档。"}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {actionId && <p role="status" className="text-sm">{en ? "Applying action…" : "正在处理…"}</p>}
        <div className="flex flex-wrap gap-3 items-center">
            <Button disabled={!!draft || !!actionId} onClick={() => edit(null)}>{en ? "New announcement" : "新增公告"}</Button>
            <label className="text-sm">{en ? "Status filter" : "状态筛选"}<select aria-label={en ? "Status filter" : "状态筛选"} className={control} disabled={!!draft || !!actionId} value={status} onChange={e => {setStatus(e.target.value); setPage(1); setData(null); setError("");}}>
                <option value="all">{en ? "All" : "全部"}</option>{statuses.map(s => <option key={s} value={s}>{en ? s : statusZh[s]}</option>)}
            </select></label>
            <Button variant="outline" disabled={saving || !!actionId} onClick={() => {setError(""); setData(null); setRevision(r => r + 1);}}>{en ? "Refresh list" : "刷新列表"}</Button>
        </div>
        {draft && <section className="border rounded-lg p-4 space-y-4" aria-label={en ? "Announcement editor" : "公告编辑"}>
            <h2 className="font-semibold">{editing ? (en ? "Edit announcement" : "编辑公告") : (en ? "New announcement" : "新增公告")}</h2>
            <form className="space-y-4" onSubmit={e => {e.preventDefault(); void save();}}>
                <fieldset disabled={saving} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <label className="text-sm">{en ? "Chinese title (required)" : "中文标题（必填）"}<input className={control} required maxLength={120} value={draft.titleZh} onChange={e => update("titleZh", e.target.value)}/></label>
                        <label className="text-sm">{en ? "English title (optional)" : "英文标题（可选）"}<input className={control} maxLength={120} value={draft.titleEn} onChange={e => update("titleEn", e.target.value)}/></label>
                        <label className="text-sm">{en ? "Chinese body (required)" : "中文正文（必填）"}<textarea className={control} rows={5} required maxLength={6000} value={draft.bodyZh} onChange={e => update("bodyZh", e.target.value)}/></label>
                        <label className="text-sm">{en ? "English body (optional)" : "英文正文（可选）"}<textarea className={control} rows={5} maxLength={6000} value={draft.bodyEn} onChange={e => update("bodyEn", e.target.value)}/></label>
                    </div>
                    <p className="text-xs text-muted-foreground">{en ? "Plain text only; missing English fields fall back to Chinese. No automatic translation." : "正文按纯文本展示；英文留空时使用中文，不自动翻译。"}</p>
                    <label className="block text-sm">{en ? "Related page (same-site path)" : "相关页面（站内路径）"}<input className={control} placeholder="/solving-records" maxLength={400} value={draft.href} onChange={e => update("href", e.target.value)}/></label>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <label className="text-sm">{en ? "Publication status" : "发布状态"}<select aria-label={en ? "Publication status" : "发布状态"} className={control} value={draft.status} onChange={e => update("status", e.target.value as AnnouncementInput["status"])}>{statuses.map(s => <option key={s} value={s}>{en ? s : statusZh[s]}</option>)}</select></label>
                        <label className="text-sm">{en ? "Read policy" : "阅读策略"}<select aria-label={en ? "Read policy" : "阅读策略"} className={control} value={draft.readPolicy} onChange={e => update("readPolicy", e.target.value as AnnouncementInput["readPolicy"])}>{policies.map(s => <option key={s} value={s}>{en ? policyEn[s] : policyZh[s]}</option>)}</select></label>
                        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={draft.pinned} onChange={e => update("pinned", e.target.checked)}/>{en ? "Pin notice" : "置顶公告"}</label>
                        <label className="text-sm">{en ? "Pin order (smaller first)" : "置顶顺序（越小越靠前）"}<input className={control} type="number" min={0} max={9999} disabled={!draft.pinned} value={draft.pinOrder} onChange={e => update("pinOrder", Number(e.target.value))}/></label>
                        <label className="text-sm">{en ? "Starts at (device local time)" : "生效时间（当前设备时区）"}<input className={control} type="datetime-local" value={localTime(draft.startsAt)} onChange={e => update("startsAt", inputTime(e.target.value))}/></label>
                        <label className="text-sm">{en ? "Ends at (device local time)" : "到期时间（当前设备时区）"}<input className={control} type="datetime-local" value={localTime(draft.endsAt)} onChange={e => update("endsAt", inputTime(e.target.value))}/></label>
                    </div>
                    <p className="text-xs text-muted-foreground">{en ? "Empty times mean no time limit. Only published notices within their time window are visible. Expired notices remain in admin. Read-and-hide never deletes the notice globally." : "时间留空表示不限制。只有已发布且在有效期内的公告可见；到期后后台仍保留。读后隐藏不会全站删除公告。"}</p>
                    <h3 className="font-semibold">{en ? "User preview" : "用户侧预览"}</h3>
                    <NoticeCard notice={{...draft, id: "preview", revision: 1, createdAt: "", updatedAt: ""}}/>
                </fieldset>
                <div className="flex flex-wrap gap-3 sticky bottom-0 bg-background py-3 border-t">
                    <Button type="submit" disabled={saving}>{saving ? (en ? "Saving…" : "保存中…") : draft.status === "published" ? (en ? "Save and publish" : "保存并发布") : (en ? "Save announcement" : "保存公告")}</Button>
                    <Button type="button" variant="outline" disabled={saving} onClick={() => {setDraft(null); setEditing(null); setError("");}}>{en ? "Cancel editing" : "取消编辑"}</Button>
                </div>
            </form>
        </section>}
        <section className="space-y-3" aria-label={en ? "Managed announcements" : "公告管理列表"}>
            {!data && !error && <p>{en ? "Loading…" : "加载中…"}</p>}
            {data?.items.map(item => <article key={item.id} className="border rounded-lg p-4 space-y-2 break-words">
                <h2 className="font-semibold">{en && item.titleEn ? item.titleEn : item.titleZh}</h2>
                <p className="text-sm text-muted-foreground">{en ? item.status : statusZh[item.status]} · {en ? policyEn[item.readPolicy] : policyZh[item.readPolicy]}{item.pinned ? ` · ${en ? "Pinned" : "置顶"} ${item.pinOrder}` : ""}</p>
                {(item.startsAt || item.endsAt) && <p className="text-xs">{en ? "Visibility window: " : "有效期："}{item.startsAt ? new Date(item.startsAt).toLocaleString() : "…"} → {item.endsAt ? new Date(item.endsAt).toLocaleString() : "…"}</p>}
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={!!draft || !!actionId} onClick={() => edit(item)}>{en ? "Edit" : "编辑"}</Button>
                    <Button variant="outline" disabled={!!draft || !!actionId} onClick={() => void directAction(item, item.pinned ? "unpin" : "pin")}>
                        {item.pinned ? (en ? "Unpin" : "取消置顶") : (en ? "Pin" : "置顶")}
                    </Button>
                    {(item.status === "published" || item.status === "hidden") && <Button variant="outline" disabled={!!draft || !!actionId} onClick={() => void directAction(item, item.status === "hidden" ? "publish" : "hide")}>
                        {item.status === "hidden" ? (en ? "Republish" : "恢复发布") : (en ? "Hide" : "隐藏")}
                    </Button>}
                    <Button variant="destructive" disabled={!!draft || !!actionId} onClick={() => void directAction(item, "delete")}>{en ? "Delete" : "删除"}</Button>
                </div>
            </article>)}
            {data?.items.length === 0 && <p>{en ? "No announcements." : "暂无公告。"}</p>}
        </section>
        {data && <div className="flex flex-wrap gap-3 items-center text-sm">
            <Button variant="outline" disabled={!!draft || !!actionId || page <= 1} onClick={() => {setPage(p => p - 1); setData(null);}}>{en ? "Previous" : "上一页"}</Button>
            <span>{en ? `Page ${page} · ${data.total} notices` : `第${page}页 · 共${data.total}条`}</span>
            <Button variant="outline" disabled={!!draft || !!actionId || page * 20 >= data.total} onClick={() => {setPage(p => p + 1); setData(null);}}>{en ? "Next" : "下一页"}</Button>
        </div>}
    </main>;
}
export default function AdminAnnouncementsPage() {
    const {data: session, status} = useSession();
    const {language} = useLanguage();
    if (status === "loading") return <p role="status">{language === "en" ? "Loading…" : "加载中…"}</p>;
    return session?.user?.role === "admin" ? <AdminNotices key={session.user.id}/> : <p role="alert">{language === "en" ? "Administrator access required." : "需要管理员权限。"}</p>;
}
