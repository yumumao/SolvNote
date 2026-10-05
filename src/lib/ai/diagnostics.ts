/** Public, fixed-vocabulary diagnostics. Never include provider text, URLs, keys or schema values. */
export const AI_DIAGNOSTIC_MESSAGES = {
    DRAWING_UNSUPPORTED: "模型表示现有构造白名单无法表达必要图形，或题设不足；已停止，未自动换模型重试。请核对题目与构造说明。",
    DRAWING_INVALID: "构造坐标或依赖不合法，例如圆弧两端半径不一致、引用点缺失或几何退化；未采用错误构图。",
    JSON_INVALID: "已收到正文，但不是完整有效的JSON；可能含额外说明或公式转义错误。",
    DRAWING_SCHEMA_FIELDS: "构图JSON的顶层、底图或步骤字段不符合约定，可能缺少必需字段或包含多余字段。",
    DRAWING_SCHEMA_POINT: "构图点名或坐标格式不符合约定；点名须为一个大写字母加至多三位数字，坐标必须为数值。",
    DRAWING_SCHEMA_OPERATION: "辅助线操作字段不符合约定，可能操作名称、必需参数或参数类型不正确。",
    DRAWING_SCHEMA_LIMIT: "构图的点数、步骤数、文字长度或数值超过支持范围。",
    JSON_SCHEMA_INVALID: "已收到JSON，但必需字段缺失或类型不符合约定。",
    GEOMETRY_INVALID: "几何证据字段不合法，例如角的顶点、射线或编号冲突；未擅自修正题设。",
    JSON_TOO_LARGE: "模型正文超过结构化解析大小限制。",
    ENVELOPE_INVALID: "接口响应外层不是约定格式，无法提取模型正文。",
    RESPONSE_EMPTY: "接口已返回，但没有可用的最终正文。",
    REASONING_ONLY: "接口只返回了思考字段，没有最终正文；思考内容未作为答案使用。",
    OUTPUT_TRUNCATED: "接口报告输出已被截断；没有把残缺内容当成完整结果。",
    OUTPUT_FILTERED: "接口报告输出被过滤或拒绝，未得到可用答案。",
    PROVIDER_FAILED: "接口明确报告生成失败，未使用残缺正文。",
    TIMEOUT_BEFORE_HEADERS: "到达调用时限前未收到响应头；服务端是否完成未知，未自动重发。",
    TIMEOUT_READING_BODY: "已收到响应头，但读取完整正文时超时；未自动重发。",
    NETWORK_BEFORE_HEADERS: "收到响应头前连接中断；服务端是否已接收未知，未自动重发。",
    NETWORK_READING_BODY: "已收到响应头，但正文读取中断；未自动重发。",
    CANCELLED_BEFORE_HEADERS: "等待响应头时调用被中止；服务端状态未知，未自动重发。",
    CANCELLED_READING_BODY: "读取正文时调用被中止；服务端状态未知，未自动重发。",
    STREAM_INCOMPLETE: "流式响应缺少有效完成事件，未把片段当成答案，未自动重发。",
    STREAM_INVALID: "流式响应事件格式异常，无法确认完成状态，未自动重发。",
} as const;
export type AIDiagnostic = keyof typeof AI_DIAGNOSTIC_MESSAGES;
export function diagnosticMessage(value: unknown): string | undefined {
    return typeof value === "string" && Object.hasOwn(AI_DIAGNOSTIC_MESSAGES, value)
        ? AI_DIAGNOSTIC_MESSAGES[value as AIDiagnostic] : undefined;
}

/** Timing/counts only; never copy arbitrary properties from errors into the audit. */
export type AITransportDiagnostics = {
    protocol: "chat" | "azure" | "responses" | "responses_codex" | "gemini";
    requestedStream: boolean;
    responseFormat?: "sse" | "json";
    headersMs?: number;
    firstByteMs?: number;
    lastByteMs?: number;
    receivedBytes: number;
    elapsedMs: number;
};
export function safeTransportDiagnostics(value: unknown): AITransportDiagnostics | undefined {
    if(!value || typeof value!=="object")return;
    const v=value as Record<string,unknown>;
    const bounded=(n:unknown,max:number):n is number=>typeof n==="number" && Number.isSafeInteger(n) && n>=0 && n<=max;
    if(!["chat","azure","responses","responses_codex","gemini"].includes(String(v.protocol)) || typeof v.requestedStream!=="boolean" || !bounded(v.receivedBytes,32*1024*1024) || !bounded(v.elapsedMs,3600000))return;
    const out:AITransportDiagnostics={protocol:v.protocol as AITransportDiagnostics["protocol"],requestedStream:v.requestedStream,receivedBytes:v.receivedBytes,elapsedMs:v.elapsedMs};
    if(v.responseFormat==="sse" || v.responseFormat==="json")out.responseFormat=v.responseFormat;
    for(const key of ["headersMs","firstByteMs","lastByteMs"] as const)if(bounded(v[key],3600000))out[key]=v[key];
    return out;
}
