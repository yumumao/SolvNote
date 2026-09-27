"use client";

import {useCallback, useEffect, useId, useRef, useState, type FormEvent} from "react";
import {useSession} from "next-auth/react";
import {useLanguage} from "@/contexts/LanguageContext";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {apiClient, ApiError} from "@/lib/api-client";
import type {AdminUser} from "@/types/api";
import {AIAccessPanel} from "@/components/ai-access-panel";

type ExpirationDays = 7 | 30 | null;
type LifetimeChoice = "7" | "30" | "permanent";
interface RegistrationPolicy {
    enabled: boolean;
    inviteRequired: boolean;
    defaultExpirationDays: ExpirationDays;
    inviteDefaultLifetimeDays: 30;
    inviteDisplayEnabled: boolean;
    displayedInviteId: string | null;
    revision: number;
    turnstileConfigured: boolean;
}
interface Invite {
    id: string;
    maxUses: number;
    usedCount: number;
    expiresAt: string;
    enabled: boolean;
    revision: number;
    createdAt: string;
}
interface Snapshot {users: AdminUser[]; policy: RegistrationPolicy; invites: Invite[]; loadedAt: number}
interface OneTimeValue {kind: "password" | "invite"; subject: string; value: string}
type RunMutation = (action: () => Promise<OneTimeValue | void>) => Promise<void>;
type UserPatch = {revision: number; isActive?: boolean; role?: "user" | "admin"; expirationDays?: ExpirationDays};

const copy = {
    en: {
        heading: "Users and registration",
        aiAccess: "AI access", closeAiAccess: "Close AI access", aiPolicyNote: "This panel also contains site-wide policy. Changes to that policy affect the whole site, not only the selected user.", refresh: "Refresh", loading: "Loading…", saving: "Saving…", saved: "Saved. Server data refreshed.",
        loadFailed: "Could not load management data. Refresh to retry.", failed: "The operation failed or could not be confirmed. Review the refreshed data before retrying.",
        refreshFailed: "The operation succeeded, but refreshing failed. Save any one-time value before refreshing; do not repeat the operation.",
        conflict: "The data changed or this action is protected. Review the refreshed data before retrying.",
        denied: "Administrator access is unavailable. Sign in again with an authorized account.", lastAdmin: "The last active administrator cannot be removed, disabled or demoted.",
        selfDenied: "This action is not allowed on your own administrator account.", turnstile: "Turnstile is not configured. Login and registration remain unavailable until it is configured.",
        createUser: "Create user", name: "Name", email: "Email", role: "Role", user: "User", admin: "Administrator", accountLifetime: "Account lifetime",
        permanent: "Permanent", seven: "7 days", thirty: "30 days", unchanged: "Keep current expiry", saveUser: "Save user", noUsers: "No users.",
        active: "Active", disabled: "Disabled", expired: "Expired", expires: "Expires", created: "Created", forceChange: "Password change required", counts: "Errors / practices",
        disableUser: "Disable user", enableUser: "Enable user", deleteUser: "Delete user", resetPassword: "Reset password",
        confirmDisable: "Change this user's active status? Existing sessions will be revoked:",
        confirmDelete: "Delete this user and their data permanently? This cannot be undone:",
        confirmReset: "Reset this user's password? Existing sessions will be revoked and a password change will be required:",
        userNote: "Expiry changes start from now. Account changes revoke existing sessions. Protected operations are enforced by the server.",
        oneTimePassword: "Temporary password", oneTimeInvite: "New invite code", oneTimeNote: "This value is shown only once. Save and share it securely before closing or taking another action.",
        passwordNote: "The user must change this temporary password after signing in.", closeSecret: "I have saved it",
        registration: "Registration policy", enabled: "Registration enabled", inviteRequired: "Invite required", defaultLifetime: "Default account lifetime",
        inviteDisplay: "Display selected invite publicly", displayedInvite: "Displayed invite", none: "None", savePolicy: "Save registration policy",
        displayNote: "Public display reveals the selected code to registration visitors. Only an enabled, unexpired invite with remaining uses is shown when registration and invite requirements are enabled.",
        invites: "Invitation codes", invite: "Invite", createInvite: "Create invite", inviteDefaults: "New invites last 30 days and allow 1 use. Codes are only returned at creation.",
        noInvites: "No invites.", used: "Used", maxUses: "Maximum uses", saveUses: "Save uses", renew: "Renew 30 days", disableInvite: "Disable invite", enableInvite: "Enable invite",
        confirmRevoke: "Disable this invite? Existing usage history is preserved:", exhausted: "No uses remaining", unavailable: "Unavailable",
    },
    zh: {
        heading: "用户与注册管理",
        aiAccess: "AI授权", closeAiAccess: "关闭AI授权", aiPolicyNote: "此面板也包含站点级策略，修改该策略会影响全站，并非仅影响当前选中的用户。", refresh: "刷新", loading: "加载中…", saving: "保存中…", saved: "已保存并刷新服务器数据。",
        loadFailed: "无法加载管理数据，请刷新重试。", failed: "操作失败或结果无法确认，请核对刷新后的数据再重试。",
        refreshFailed: "操作已成功，但刷新失败。请先保存一次性信息再刷新，不要重复执行操作。",
        conflict: "数据已变更或操作受到保护，请核对刷新后的数据再重试。",
        denied: "当前无管理员访问权限，请使用有权限的账号重新登录。", lastAdmin: "不能删除、停用或降级最后一位有效管理员。",
        selfDenied: "不能对自己的管理员账号执行此操作。", turnstile: "Turnstile尚未配置，完成配置前登录和注册均不可用。",
        createUser: "创建用户", name: "姓名", email: "邮箱", role: "角色", user: "用户", admin: "管理员", accountLifetime: "账号有效期",
        permanent: "永久", seven: "7天", thirty: "30天", unchanged: "保持当前到期时间", saveUser: "保存用户", noUsers: "暂无用户。",
        active: "启用", disabled: "停用", expired: "已到期", expires: "到期时间", created: "创建时间", forceChange: "需要修改密码", counts: "错题 / 练习",
        disableUser: "停用用户", enableUser: "启用用户", deleteUser: "删除用户", resetPassword: "重置密码",
        confirmDisable: "确认更改此用户的启停状态？现有会话将失效：",
        confirmDelete: "确认永久删除此用户及其数据？此操作无法撤销：",
        confirmReset: "确认重置此用户的密码？现有会话将失效，用户需重新登录并修改密码：",
        userNote: "有效期修改从当前时间计算。账号修改会使现有会话失效，保护规则以服务器校验为准。",
        oneTimePassword: "临时密码", oneTimeInvite: "新邀请码", oneTimeNote: "仅本次显示。关闭或执行其他操作前，请安全保存并转交；关闭后无法再次查看。",
        passwordNote: "用户登录后必须修改此临时密码。", closeSecret: "我已保存",
        registration: "注册设置", enabled: "开放注册", inviteRequired: "需要邀请码", defaultLifetime: "注册账号默认有效期",
        inviteDisplay: "公开展示选定邀请码", displayedInvite: "展示的邀请码", none: "不选择", savePolicy: "保存注册设置",
        displayNote: "公开展示会向注册访客显示该邀请码。仅在开放注册、要求邀请码且所选邀请码已启用、未过期、有剩余次数时展示。",
        invites: "邀请码管理", invite: "邀请码", createInvite: "创建邀请码", inviteDefaults: "新邀请码默认30天有效、可用1次，明文仅在创建时返回。",
        noInvites: "暂无邀请码。", used: "已使用", maxUses: "使用次数上限", saveUses: "保存次数", renew: "续期30天", disableInvite: "停用邀请码", enableInvite: "启用邀请码",
        confirmRevoke: "确认停用此邀请码？已有使用记录将保留：", exhausted: "次数已用尽", unavailable: "不可用",
    },
};
type Text = typeof copy.en;
const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const panelClass = "space-y-4 rounded-lg border bg-card p-4";
const lifetime = (value: LifetimeChoice): ExpirationDays => value === "permanent" ? null : value === "7" ? 7 : 30;
const lifetimeChoice = (value: ExpirationDays): LifetimeChoice => value === null ? "permanent" : value === 7 ? "7" : "30";
const dateLabel = (value: string, language: string) => new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
const inviteUsable = (invite: Invite, now: number) => invite.enabled && Date.parse(invite.expiresAt) > now && invite.usedCount < invite.maxUses;

function LifetimeOptions({c, keep = false}: {c: Text; keep?: boolean}) {
    return <>{keep && <option value="keep">{c.unchanged}</option>}<option value="permanent">{c.permanent}</option><option value="7">{c.seven}</option><option value="30">{c.thirty}</option></>;
}
function RoleOptions({c}: {c: Text}) {
    return <><option value="user">{c.user}</option><option value="admin">{c.admin}</option></>;
}
function OneTimeNotice({secret, c, dismiss}: {secret: OneTimeValue; c: Text; dismiss: () => void}) {
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {panel.current?.focus();}, [secret]);
    return <section ref={panel} role="dialog" tabIndex={-1} aria-label={secret.kind === "password" ? c.oneTimePassword : c.oneTimeInvite} className="space-y-3 rounded-lg border border-amber-500 bg-amber-500/10 p-4">
        <h3 className="font-semibold">{secret.kind === "password" ? c.oneTimePassword : c.oneTimeInvite}</h3>
        <p className="break-all text-sm">{secret.subject}</p><p>{c.oneTimeNote}</p>
        <code className="block select-all break-all rounded bg-background p-3 text-lg">{secret.value}</code>
        {secret.kind === "password" && <p className="text-sm">{c.passwordNote}</p>}
        <Button type="button" onClick={dismiss}>{c.closeSecret}</Button>
    </section>;
}

function CreateUser({c, busy, run}: {c: Text; busy: boolean; run: RunMutation}) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<"user" | "admin">("user");
    const [days, setDays] = useState<LifetimeChoice>("permanent");
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !event.currentTarget.checkValidity() || !name.trim() || !email.trim()) return;
        void run(async () => {
            const result = await apiClient.post<{user: AdminUser; temporaryPassword: string}>("/api/admin/users", {email: email.trim(), name: name.trim(), role, expirationDays: lifetime(days)});
            return {kind: "password", subject: result.user.email, value: result.temporaryPassword};
        });
    }
    return <section aria-label={c.createUser} className={panelClass}>
        <h3 className="font-semibold">{c.createUser}</h3>
        <form onSubmit={submit}><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">{c.name}<input aria-label={c.name} required maxLength={100} value={name} onChange={e => setName(e.target.value)} autoComplete="off" className={inputClass}/></label>
            <label className="space-y-1 text-sm">{c.email}<input aria-label={c.email} required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" className={inputClass}/></label>
            <label className="space-y-1 text-sm">{c.role}<select aria-label={c.role} value={role} onChange={e => setRole(e.target.value as "user" | "admin")} className={inputClass}><RoleOptions c={c}/></select></label>
            <label className="space-y-1 text-sm">{c.accountLifetime}<select aria-label={c.accountLifetime} value={days} onChange={e => setDays(e.target.value as LifetimeChoice)} className={inputClass}><LifetimeOptions c={c}/></select></label>
            <Button type="submit" disabled={busy || !name.trim() || !email.trim()}>{c.createUser}</Button>
        </fieldset></form>
    </section>;
}

function UserCard({user, c, language, busy, self, run, now, aiExpanded, aiPanelId, onAiAccess}: {user: AdminUser; c: Text; language: string; busy: boolean; self: boolean; run: RunMutation; now: number; aiExpanded: boolean; aiPanelId: string; onAiAccess: () => void}) {
    const [role, setRole] = useState<"user" | "admin">(user.role);
    const [days, setDays] = useState<LifetimeChoice | "keep">("keep");
    const url = `/api/admin/users/${encodeURIComponent(user.id)}`;
    const expired = user.expiresAt !== null && Date.parse(user.expiresAt) <= now;
    function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy || self || (role === user.role && days === "keep")) return;
        const body: UserPatch = {revision: user.revision};
        if (role !== user.role) body.role = role;
        if (days !== "keep") body.expirationDays = lifetime(days);
        void run(async () => {await apiClient.patch<AdminUser>(url, body);});
    }
    return <section aria-label={`${c.user} ${user.email}`} className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h4 className="break-words font-medium">{user.name || user.email}</h4><p className="break-all text-sm text-muted-foreground">{user.email}</p></div>
            <div className="flex flex-wrap gap-2"><Badge variant={user.isActive ? "secondary" : "destructive"}>{user.isActive ? c.active : c.disabled}</Badge>{expired && <Badge variant="destructive">{c.expired}</Badge>}{user.mustChangePassword && <Badge variant="outline">{c.forceChange}</Badge>}</div>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground"><p>{c.expires}: {user.expiresAt ? dateLabel(user.expiresAt, language) : c.permanent}</p><p>{c.created}: {dateLabel(user.createdAt, language)}</p>{user._count && <p>{c.counts}: {user._count.errorItems} / {user._count.practiceRecords}</p>}</div>
        <form onSubmit={save}><fieldset disabled={busy || self} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">{c.role}<select aria-label={c.role} disabled={busy || self} className={inputClass} value={role} onChange={e => setRole(e.target.value as "user" | "admin")}><RoleOptions c={c}/></select></label>
            <label className="space-y-1 text-sm">{c.accountLifetime}<select aria-label={c.accountLifetime} disabled={busy || self} className={inputClass} value={days} onChange={e => setDays(e.target.value as LifetimeChoice | "keep")}><LifetimeOptions c={c} keep/></select></label>
            <Button type="submit" variant="outline" disabled={busy || self || (role === user.role && days === "keep")}>{c.saveUser}</Button>
        </fieldset></form>
        <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy || self} onClick={() => {
                if (window.confirm(`${c.confirmDisable}\n${user.email}`)) void run(async () => {await apiClient.patch<AdminUser>(url, {revision: user.revision, isActive: !user.isActive});});
            }}>{user.isActive ? c.disableUser : c.enableUser}</Button>
            <Button type="button" variant="outline" disabled={busy || self} onClick={() => {
                if (window.confirm(`${c.confirmReset}\n${user.email}`)) void run(async () => {
                    const result = await apiClient.post<{temporaryPassword: string}>(`${url}/reset-password`, {revision: user.revision});
                    return {kind: "password", subject: user.email, value: result.temporaryPassword};
                });
            }}>{c.resetPassword}</Button>
            <Button type="button" variant="destructive" disabled={busy || self} onClick={() => {
                if (window.confirm(`${c.confirmDelete}\n${user.email}`)) void run(async () => {await apiClient.delete(url, {body: JSON.stringify({revision: user.revision})});});
            }}>{c.deleteUser}</Button>
            <Button type="button" variant="outline" disabled={busy} aria-expanded={aiExpanded} aria-controls={aiPanelId} onClick={onAiAccess}>{c.aiAccess}</Button>
        </div>
    </section>;
}

function RegistrationForm({policy, invites, c, busy, run, now}: {policy: RegistrationPolicy; invites: Invite[]; c: Text; busy: boolean; run: RunMutation; now: number}) {
    const [enabled, setEnabled] = useState(policy.enabled);
    const [inviteRequired, setInviteRequired] = useState(policy.inviteRequired);
    const [days, setDays] = useState<LifetimeChoice>(lifetimeChoice(policy.defaultExpirationDays));
    const [display, setDisplay] = useState(policy.inviteDisplayEnabled);
    const [selected, setSelected] = useState(policy.displayedInviteId || "");
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy) return;
        void run(async () => {await apiClient.patch<RegistrationPolicy>("/api/admin/registration", {
            revision: policy.revision, enabled, inviteRequired, defaultExpirationDays: lifetime(days), inviteDisplayEnabled: display, displayedInviteId: selected || null,
        });});
    }
    return <section aria-label={c.registration} className={panelClass}>
        <h3 className="font-semibold">{c.registration}</h3>
        {!policy.turnstileConfigured && <p role="alert" className="text-sm text-destructive">{c.turnstile}</p>}
        <form onSubmit={submit}><fieldset disabled={busy} className="space-y-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={c.enabled} checked={enabled} onChange={e => setEnabled(e.target.checked)}/>{c.enabled}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={c.inviteRequired} checked={inviteRequired} onChange={e => setInviteRequired(e.target.checked)}/>{c.inviteRequired}</label>
            <label className="block space-y-1 text-sm">{c.defaultLifetime}<select aria-label={c.defaultLifetime} className={inputClass} value={days} onChange={e => setDays(e.target.value as LifetimeChoice)}><LifetimeOptions c={c}/></select></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={c.inviteDisplay} checked={display} onChange={e => setDisplay(e.target.checked)}/>{c.inviteDisplay}</label>
            <label className="block space-y-1 text-sm">{c.displayedInvite}<select aria-label={c.displayedInvite} className={inputClass} value={selected} onChange={e => setSelected(e.target.value)}>
                <option value="">{c.none}</option>
                {selected && !invites.some(i => i.id === selected) && <option value={selected} disabled>{selected} ({c.unavailable})</option>}
                {invites.map(invite => <option key={invite.id} value={invite.id} disabled={!inviteUsable(invite, now)}>{invite.id} ({invite.usedCount}/{invite.maxUses}){!inviteUsable(invite, now) ? ` - ${c.unavailable}` : ""}</option>)}
            </select></label>
            <p className="text-sm text-muted-foreground">{c.displayNote}</p>
            <Button type="submit" disabled={busy}>{c.savePolicy}</Button>
        </fieldset></form>
    </section>;
}

function InviteCard({invite, c, language, busy, run, now}: {invite: Invite; c: Text; language: string; busy: boolean; run: RunMutation; now: number}) {
    const [uses, setUses] = useState(String(invite.maxUses));
    const maxUses = Number(uses);
    const valid = uses.trim() !== "" && Number.isInteger(maxUses) && maxUses >= Math.max(1, invite.usedCount) && maxUses <= 10000;
    const url = `/api/admin/invites/${encodeURIComponent(invite.id)}`;
    return <section aria-label={`${c.invite} ${invite.id}`} className={panelClass}>
        <h4 className="break-all font-mono text-sm">{invite.id}</h4>
        <div className="flex flex-wrap gap-2"><Badge variant={invite.enabled ? "secondary" : "destructive"}>{invite.enabled ? c.active : c.disabled}</Badge>{Date.parse(invite.expiresAt) <= now && <Badge variant="destructive">{c.expired}</Badge>}{invite.usedCount >= invite.maxUses && <Badge variant="outline">{c.exhausted}</Badge>}</div>
        <p className="text-sm">{c.used}: {invite.usedCount} / {invite.maxUses}</p><p className="text-sm text-muted-foreground">{c.expires}: {dateLabel(invite.expiresAt, language)}</p>
        <form onSubmit={event => {event.preventDefault(); if (!busy && valid) void run(async () => {await apiClient.patch<Invite>(url, {revision: invite.revision, maxUses});});}}>
            <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">{c.maxUses}<input aria-label={c.maxUses} type="number" required min={Math.max(1, invite.usedCount)} max={10000} step={1} value={uses} onChange={e => setUses(e.target.value)} className={inputClass}/></label>
                <Button type="submit" variant="outline" disabled={busy || !valid || maxUses === invite.maxUses}>{c.saveUses}</Button>
            </fieldset>
        </form>
        <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => {await apiClient.patch<Invite>(url, {revision: invite.revision, renewDays: 30});})}>{c.renew}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => {
                if (invite.enabled) {
                    if (window.confirm(`${c.confirmRevoke}\n${invite.id}`)) void run(async () => {await apiClient.delete<Invite>(url, {body: JSON.stringify({revision: invite.revision})});});
                } else void run(async () => {await apiClient.patch<Invite>(url, {revision: invite.revision, enabled: true});});
            }}>{invite.enabled ? c.disableInvite : c.enableInvite}</Button>
        </div>
    </section>;
}

export function UserManagement() {
    const {data: session} = useSession();
    const {language} = useLanguage();
    const c = language === "zh" ? copy.zh : copy.en;
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [version, setVersion] = useState(0);
    const [aiUserId, setAiUserId] = useState<string | null>(null);
    const aiPanelId = useId();
    const aiPanelRef = useRef<HTMLElement>(null);
    const aiUser = snapshot?.users.find(user => user.id === aiUserId);
    useEffect(() => {aiPanelRef.current?.focus();}, [aiUserId]);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState<keyof Text | null>(null);
    const [saved, setSaved] = useState(false);
    const [secret, setSecret] = useState<OneTimeValue | null>(null);
    const locked = useRef(true);
    const mounted = useRef(false);
    const generation = useRef(0);
    const reload = useCallback(async () => {
        const current = ++generation.current;
        // Read only safe DTO endpoints. Never request legacy settings or secret-bearing profiles.
        const [users, policy, invites] = await Promise.all([
            apiClient.get<AdminUser[]>("/api/admin/users"),
            apiClient.get<RegistrationPolicy>("/api/admin/registration"),
            apiClient.get<Invite[]>("/api/admin/invites"),
        ]);
        if (mounted.current && current === generation.current) {setSnapshot({users, policy, invites, loadedAt: Date.now()}); setVersion(v => v + 1);}
    }, []);
    useEffect(() => {
        mounted.current = true; let cancelled = false;
        void reload().catch(() => {if (!cancelled) setError("loadFailed");}).finally(() => {if (!cancelled) {locked.current = false; setBusy(false);}});
        return () => {cancelled = true; mounted.current = false;};
    }, [reload]);

    async function refresh() {
        if (locked.current) return;
        locked.current = true; setBusy(true); setError(null); setSaved(false); setSecret(null);
        try {await reload();} catch {if (mounted.current) {setSnapshot(null); setError("loadFailed");}}
        finally {locked.current = false; if (mounted.current) setBusy(false);}
    }
    async function run(action: () => Promise<OneTimeValue | void>) {
        // State alone cannot guard two submissions within the same render tick.
        if (locked.current || !snapshot) return;
        locked.current = true; setBusy(true); setError(null); setSaved(false); setSecret(null);
        try {
            const result = await action();
            if (!mounted.current) return;
            if (result) setSecret(result);
            try {await reload(); if (mounted.current) setSaved(true);}
            catch {if (mounted.current) {setSnapshot(null); setError("refreshFailed");}}
        } catch (err) {
            if (!mounted.current) return;
            let message: keyof Text = "failed";
            if (err instanceof ApiError) {
                const code = typeof err.data === "object" && err.data !== null && "error" in err.data ? err.data.error : null;
                if (err.status === 409) message = "conflict";
                if (code === "LAST_ADMIN") message = "lastAdmin";
                if (code === "SELF_ACTION_DENIED") message = "selfDenied";
                if (code === "TURNSTILE_NOT_CONFIGURED") message = "turnstile";
                if (err.status === 401 || err.status === 403) {
                    setSnapshot(null); setError("denied"); return;
                }
            }
            setError(message);
            // A timeout may have committed. Reconcile reads, never replay a write automatically.
            try {await reload();} catch {if (mounted.current) setSnapshot(null);}
        } finally {locked.current = false; if (mounted.current) setBusy(false);}
    }
    return <div className="space-y-6" aria-busy={busy}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{c.heading}</h2><Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>{c.refresh}</Button></div>
        {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{c[error]}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">{c.saved}</p>}
        {busy && <p role="status" className="text-sm text-muted-foreground">{snapshot ? c.saving : c.loading}</p>}
        {secret && <OneTimeNotice secret={secret} c={c} dismiss={() => setSecret(null)}/>}
        {snapshot && <>
            <CreateUser key={`create-${version}`} c={c} busy={busy} run={run}/>
            <p className="text-sm text-muted-foreground">{c.userNote}</p>
            {!snapshot.users.length && <p>{c.noUsers}</p>}
            <div className="grid items-start gap-4 lg:grid-cols-2">{snapshot.users.map(user => <UserCard key={`${user.id}-${version}`} user={user} c={c} language={language} busy={busy} self={user.id === session?.user?.id} run={run} now={snapshot.loadedAt} aiExpanded={aiUserId === user.id} aiPanelId={aiPanelId} onAiAccess={() => setAiUserId(current => current === user.id ? null : user.id)}/>)}</div>
            {aiUser && <section ref={aiPanelRef} id={aiPanelId} tabIndex={-1} aria-label={`${c.aiAccess}: ${aiUser.email}`} className={panelClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="break-all font-semibold">{c.aiAccess}: {aiUser.email}</h3>
                    <Button type="button" variant="outline" onClick={() => setAiUserId(null)}>{c.closeAiAccess}</Button>
                </div>
                <p className="text-sm text-muted-foreground">{c.aiPolicyNote}</p>
                <fieldset disabled={busy}>
                    {/* One selected account only. Keying prevents drafts leaking across accounts. */}
                    <AIAccessPanel key={aiUser.id} userId={aiUser.id}/>
                </fieldset>
            </section>}
            <RegistrationForm key={`policy-${version}`} policy={snapshot.policy} invites={snapshot.invites} c={c} busy={busy} run={run} now={snapshot.loadedAt}/>
            <section aria-label={c.invites} className="space-y-4">
                <h3 className="font-semibold">{c.invites}</h3><p className="text-sm text-muted-foreground">{c.inviteDefaults}</p>
                <Button type="button" disabled={busy} onClick={() => void run(async () => {
                    const result = await apiClient.post<{invite: Invite; code: string}>("/api/admin/invites", {lifetimeDays: 30, maxUses: 1});
                    return {kind: "invite", subject: result.invite.id, value: result.code};
                })}>{c.createInvite}</Button>
                {!snapshot.invites.length && <p>{c.noInvites}</p>}
                <div className="grid items-start gap-4 lg:grid-cols-2">{snapshot.invites.map(invite => <InviteCard key={`${invite.id}-${version}`} invite={invite} c={c} language={language} busy={busy} run={run} now={snapshot.loadedAt}/>)}</div>
            </section>
        </>}
    </div>;
}
