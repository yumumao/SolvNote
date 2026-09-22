/** Public diagnostics contain only schema paths and fixed reason codes, never values. */
export interface ImportIssue {
    path: string;
    reason: "URL_POLICY" | "FIELD_CONSTRAINT" | "REFERENCES_OR_CHAINS";
}
export function safeIssuePath(path: unknown[]): string {
    const joined = path.join(".");
    return /^(?:version|providers(?:\.\d{1,3}(?:\.(?:id|name|protocol|baseUrl|apiKey|enabled|apiVersion))?)?|models(?:\.\d{1,3}(?:\.(?:id|providerId|name|model|capabilities(?:\.\d)?|enabled))?)?|chains(?:\.(?:text|vision)(?:\.\d{1,3})?)?)$/.test(joined) ? joined : "config";
}
export class ImportConfigError extends Error {
    readonly issues: ImportIssue[];
    constructor(issues: ImportIssue[]) {
        super("IMPORT_CONFIG_INCOMPATIBLE");
        this.issues = issues.slice(0, 16).map((issue) => ({
            path: safeIssuePath(issue.path.split(".")),
            reason: ["URL_POLICY", "FIELD_CONSTRAINT", "REFERENCES_OR_CHAINS"].includes(issue.reason) ? issue.reason : "FIELD_CONSTRAINT",
        }));
    }
}

/** Never display arbitrary response text/HTML or error.message from a server/proxy. */
export function importErrorMessage(error: unknown, action: "preview" | "apply"): string {
    const e = error && typeof error === "object" ? error as { status?: unknown; data?: unknown } : {};
    const data = e.data && typeof e.data === "object" ? e.data as { message?: unknown; issues?: unknown } : {};
    const code = typeof data.message === "string" ? data.message : "";
    const messages: Record<string, string> = {
        IMPORT_CONFIG_INCOMPATIBLE: "口令验证已通过，但解密后的配置不符合本站要求。未写入配置。",
        IMPORT_MERGE_INCOMPATIBLE: "口令验证已通过，但合并后超过数量限制或引用不兼容。请整理现有配置后重新预览；不要为了绕过错误直接替换。未写入配置。",
        INVALID_EXPORT_OR_PASSPHRASE: "加密校验失败：导出口令与此文件不匹配，或密文被改动。请核对文件与口令是否为同一次导出，注意空格和大小写。未写入配置。",
        UNSUPPORTED_EXPORT: "不支持此文件的格式版本或加密参数，请使用portable-ai-config v1文件并确认两端版本。未写入配置。",
        INVALID_EXPORT: "文件信封或口令长度不符合要求，请检查是否选中了加密导出文件。未写入配置。",
        INVALID_EXPORT_PAYLOAD: "口令验证已通过，但解密内容不是有效JSON配置，请重新导出。未写入配置。",
        AI_MASTER_KEY_MISSING: "本站持久化主钥缺失，与导出口令无关。请检查/app/config挂载，恢复与/app/data数据库配对的原主钥；不要生成新钥覆盖。未写入配置。",
        AI_MASTER_KEY_INVALID: "本站持久化主钥无效，与导出口令无关。请核对AI_CONFIG_MASTER_KEY及/app/config中的原主钥，不要重置数据库。未写入配置。",
        IMPORT_STORAGE_UNAVAILABLE: "本站读取、解密或保存持久配置失败，与导出口令无关。请检查/app/config与/app/data挂载、权限、迁移及数据库配对主钥。",
        IMPORT_ORIGIN_REJECTED: "请求被错题本的同源校验拒绝。这里检查的是错题本页面地址，不是ScanDex的地址或文件来源；两个项目可以使用不同地址。请从错题本正式地址重新登录，并让错题本后台NEXTAUTH_URL与该地址的协议、主机和端口一致；localhost和127.0.0.1不能混用。此次未读取导入文件，未写入配置。",
        CONFIG_CONFLICT: "预览已过期或配置已变化，请重新预览后确认导入。未写入配置。",
        IMPORT_PREVIEW_INVALID: "预览确认信息不匹配，请重新预览后确认导入。未写入配置。",
        UNAUTHORIZED: "登录已过期，请重新登录后导入。",
        FORBIDDEN: "只有管理员可以导入，请检查账号权限和访问地址。",
        AUTHENTICATION_UNAVAILABLE: "服务端认证暂不可用，请检查认证服务及站点地址配置后重试。",
        BODY_TOO_LARGE: "文件或请求超过体积限制，请确认加密文件不超过1MiB，并检查反向代理限制。",
        INVALID_REQUEST: "导入请求无效，请刷新页面后重新选择文件并预览。",
    };
    if (Object.hasOwn(messages, code)) {
        let result = messages[code] + `（${code}）`;
        if (code === "IMPORT_CONFIG_INCOMPATIBLE" && Array.isArray(data.issues)) {
            const reasons = { URL_POLICY: "地址须为HTTPS且不含账号、查询参数或片段；不会自动改写地址或丢弃连接", FIELD_CONSTRAINT: "字段类型、长度或数量不符合限制", REFERENCES_OR_CHAINS: "检查连接引用、启用状态与调用链能力" };
            const issues = data.issues.slice(0, 16).flatMap((issue: unknown) => {
                if (!issue || typeof issue !== "object") return [];
                const value = issue as ImportIssue;
                const field = typeof value.path === "string" ? safeIssuePath(value.path.split(".")) : "config";
                const reason = Object.hasOwn(reasons, value.reason) ? reasons[value.reason] : reasons.FIELD_CONSTRAINT;
                return [`${field}：${reason}`];
            });
            if (issues.length) result += " " + issues.join("；") + "。数组序号从0开始。";
        }
        if (action === "apply" && code === "IMPORT_STORAGE_UNAVAILABLE") result += "先刷新核对保存结果，不要自动重复提交。";
        return result;
    }
    const status = Number(e.status);
    if (status === 401) return messages.UNAUTHORIZED + "（HTTP 401）";
    if (status === 403) return messages.FORBIDDEN + "（HTTP 403）";
    if (status === 404 || status === 405) return `后台尚未提供导入接口，请确认部署了最新错题本后台，而非仅刷新前端。（HTTP ${status}）`;
    if (status === 413) return messages.BODY_TOO_LARGE + "（HTTP 413）";
    if (status === 409) return messages.CONFIG_CONFLICT + "（HTTP 409）";
    const suffix = action === "apply" ? "确认结果未知，请先刷新核对保存结果，不要重复提交。" : "预览不会写入AI配置，可检查服务后重新预览。";
    if (status === 408) return "导入请求超时，不代表口令错误。" + suffix;
    if (status >= 500 && status <= 599) return `后台或反向代理异常（HTTP ${status}），不代表口令错误。` + suffix;
    if (code === "INVALID_REQUEST_OR_CONFIGURATION") return "后台返回旧版通用错误，暂不能区分口令、配置或存储问题，请更新错题本后台后重新预览。" + suffix;
    return "未获得可识别的导入响应，请检查网络和后台版本；不能据此认定口令错误。" + suffix;
}
