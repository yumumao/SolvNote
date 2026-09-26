"use client";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const button = "border rounded-md px-3 py-2 text-sm disabled:opacity-40 hover:bg-muted";
function exportError(error: unknown): string {
    const e = error as {status?: number; data?: {message?: string}} | null;
    const code = e?.data?.message;
    if (code === "IMPORT_ORIGIN_REJECTED") return "导出被同源校验拒绝。请关闭此窗口，查看页面的站点地址检查，对照浏览器地址与NEXTAUTH_URL；与ScanDex文件来源无关。未导出文件。";
    if (code === "CONFIG_CONFLICT") return "配置已被其他操作更新，请刷新页面、核对配置后重新导出。";
    if (code === "PASSPHRASE_LENGTH") return "口令须为12至1024个字符，不能全为空白。";
    if (code === "EXPORT_TOO_LARGE" || e?.status === 413) return "加密文件超过1MiB或请求过大，未下载文件。请减少配置后重试。";
    if (e?.status === 401) return "登录已过期，请重新登录。";
    if (e?.status === 403) return "只有管理员可以导出，请检查账号权限。";
    if (e?.status === 404 || e?.status === 405) return "后台尚未提供导出接口，请部署最新错题本后台。";
    return "导出失败，未下载文件。请检查网络、后台版本和加密配置存储；不会修改已保存配置。";
}
// Strictly project the encrypted envelope; never serialize a plaintext config/error response.
function encryptedFile(raw: unknown) {
    const e = raw as Record<string, unknown> | null;
    if (!e || e.format !== "portable-ai-config" || e.v !== 1 || e.alg !== "AES-256-GCM" || e.kdf !== "PBKDF2-SHA256" || e.iter !== 300000 ||
        ![e.salt, e.iv, e.data].every(v => typeof v === "string" && v.length > 0)) throw Error("INVALID_EXPORT_RESPONSE");
    const blob = new Blob([JSON.stringify({format:e.format,v:e.v,alg:e.alg,kdf:e.kdf,iter:e.iter,salt:e.salt,iv:e.iv,data:e.data})], {type:"application/json"});
    if (blob.size > 1024 * 1024) throw Error("INVALID_EXPORT_RESPONSE");
    return blob;
}
export function AIConfigExport({disabled, revision}: {disabled: boolean; revision: number}) {
    const [open,setOpen] = useState(false), [busy,setBusy] = useState(false);
    const [password,setPassword] = useState(""), [confirm,setConfirm] = useState(""), [message,setMessage] = useState("");
    const inFlight = useRef(false), downloadUrl = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    function release() {if (timer.current) clearTimeout(timer.current); timer.current=null; if(downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current=null;}
    useEffect(() => () => { if(timer.current) clearTimeout(timer.current); if(downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
    function changeOpen(value: boolean) {if(inFlight.current) return;setOpen(value);setPassword("");setConfirm("");setMessage("");release();}
    async function download() {
        if(inFlight.current || disabled) return;
        if(password.length < 12 || password.length > 1024 || !password.trim()) {setMessage("口令须为12至1024个字符，不能全为空白。");return;}
        if(password !== confirm) {setMessage("两次口令不一致。");return;}
        inFlight.current=true;setBusy(true);setMessage("");
        try {
            const result = await apiClient.post<unknown>("/api/ai/config/export",{password,revision});
            const blob=encryptedFile(result); release(); downloadUrl.current=URL.createObjectURL(blob);
            const a=document.createElement("a");a.href=downloadUrl.current;a.download="solvnote.aiconfig.enc.json";
            document.body.appendChild(a);try {a.click();} finally {a.remove();}
            timer.current=setTimeout(release,30000);
            setMessage("已生成加密文件并发起下载，请检查浏览器下载记录。口令请单独保管。");
        } catch(error) {release();setMessage(exportError(error));}
        finally {setPassword("");setConfirm("");inFlight.current=false;setBusy(false);}
    }
    return <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild><button className={button} disabled={disabled} title={disabled ? "请先加载并保存设置" : "导出已保存的AI配置"}>导出配置</button></DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>导出加密AI配置</DialogTitle><DialogDescription>仅管理员可导出。兼容现有portable-ai-config v1导入，不改变文件协议。</DialogDescription></DialogHeader>
            <p className="text-sm">仅导出服务端已保存的连接、API Key、模型能力和调用顺序，不含题目、账户或站点主钥。文件含敏感密钥，请妥善保管，不要上传公开仓库。</p>
            <p className="text-sm">请使用独立口令，不要使用登录密码。口令将发送到本站后台加密，线上务必使用HTTPS；加密文件至多1MiB。</p>
            <fieldset disabled={busy} className="space-y-3 min-w-0">
                <label className="block text-sm">设置导出口令<input aria-label="设置导出口令" type="password" autoComplete="new-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} className="border rounded-md p-2 w-full bg-background" /></label>
                <label className="block text-sm">再次输入导出口令<input aria-label="再次输入导出口令" type="password" autoComplete="new-password" maxLength={1024} value={confirm} onChange={e=>setConfirm(e.target.value)} className="border rounded-md p-2 w-full bg-background" /></label>
                <div className="flex gap-2"><button className={button} onClick={download} disabled={disabled}>{busy ? "加密中…" : "加密并下载"}</button><button className={button} onClick={()=>changeOpen(false)}>关闭</button></div>
            </fieldset>
            <p role="status" className="text-sm break-words">{message}</p>
        </DialogContent>
    </Dialog>;
}
