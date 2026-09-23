"use client";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
type Diagnostic = {state: "configured" | "missing" | "invalid"; canonicalOrigin: string | null};
function parse(raw: Diagnostic): Diagnostic | null {
    if (!raw || !["configured","missing","invalid"].includes(raw.state)) return null;
    if(raw.state !== "configured") return {state:raw.state,canonicalOrigin:null};
    try {
        const url=new URL(raw.canonicalOrigin!);
        if(!["http:","https:"].includes(url.protocol) || url.username || url.password || url.origin !== raw.canonicalOrigin) return null;
        return {state:"configured",canonicalOrigin:url.origin};
    } catch {return null;}
}
export function AIOriginStatus() {
    const [data,setData]=useState<Diagnostic | null>(null), [browser,setBrowser]=useState(""), [failed,setFailed]=useState(false), [retry,setRetry]=useState(0);
    useEffect(()=>{
        let active=true;
        apiClient.get<Diagnostic>("/api/ai/config/origin").then(raw=>{if(active){setBrowser(window.location.origin);const d=parse(raw);setData(d);setFailed(!d);}}).catch(()=>{if(active){setBrowser(window.location.origin);setData(null);setFailed(true);}});
        return ()=>{active=false;};
    },[retry]);
    const matches=data?.state === "configured" && data.canonicalOrigin === browser;
    return <details open={!!data && !matches} className="border rounded-md p-3 text-sm break-words">
        <summary className="cursor-pointer">站点地址检查 · {matches ? "地址一致" : data ? "需要检查" : failed ? "暂不可用" : "检查中…"}</summary>
        <div className="mt-2 space-y-2" role={data && !matches ? "alert" : undefined}>
            <p>浏览器页面地址：<code className="break-all">{browser}</code></p>
            {data && <p>后台NEXTAUTH_URL：<code className="break-all">{data.canonicalOrigin || (data.state === "missing" ? "未设置" : "格式无效（不显示原值）")}</code></p>}
            {failed && <p>无法获取诊断，请确认管理员登录状态和后台版本；不要据此判断口令错误。</p>}
            {data && !matches && <p>{data.state === "missing" ? "未显式设置站点地址，反向代理部署可能因此拒绝写入。" : data.state === "invalid" ? "站点地址配置无效。" : "浏览器与后台规范地址不一致。"}如果浏览器使用的确实是错题本正式地址，请在Zeabur将NEXTAUTH_URL设置为上面的浏览器页面地址（协议、主机和端口须一致），保留/app/config和/app/data两卷，重新部署后从该地址重新登录。若浏览器用了临时地址，请改用正式地址，不要随意修改后台。</p>}
            <p>这里核对的是错题本站点，不是ScanDex的地址或导出文件来源。两个项目可用不同地址；localhost与127.0.0.1不能混用。地址一致但仍被拒绝时，请检查反向代理是否改写或移除Origin/浏览器请求来源信息，勿关闭同源保护。</p>
            <button className="border rounded px-2 py-1" onClick={()=>{setFailed(false);setData(null);setRetry(n=>n+1);}}>刷新地址检查</button>
        </div>
    </details>;
}
