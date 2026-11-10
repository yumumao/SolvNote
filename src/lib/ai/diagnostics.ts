/** Public, fixed-vocabulary diagnostics. Never include provider text, URLs, keys or schema values. */
export const AI_DIAGNOSTIC_MESSAGES = {
    DRAWING_UNSUPPORTED: "本模型未提供可用构造，可能认为现有构造白名单无法表达、题设不足或无需辅助线。这是模型判断；请结合本次任务的后续尝试记录核对题目与构造说明。",
    DRAWING_INVALID: "构造坐标或依赖不合法，例如圆弧两端半径不一致、引用点缺失或几何退化；未采用错误构图。",
    JSON_INVALID: "已收到正文，但不是完整有效的JSON；可能含额外说明或公式转义错误。",
    DRAWING_SCHEMA_FIELDS: "构图JSON的顶层、底图或步骤字段不符合约定，可能缺少必需字段或包含多余字段。",
    DRAWING_SCHEMA_POINT: "构图点名或坐标格式不符合约定；点名须为一个大写字母加至多三位数字，坐标必须为数值。",
    DRAWING_SCHEMA_OPERATION: "辅助线操作字段不符合约定，可能操作名称、必需参数或参数类型不正确。",
    DRAWING_SCHEMA_LIMIT: "构图的点数、步骤数、文字长度或数值超过支持范围。",
    JSON_SCHEMA_INVALID: "已收到JSON，但必需字段缺失或类型不符合约定。",
    GEOMETRY_INVALID: "几何证据字段不合法，例如角的顶点、射线或编号冲突；未擅自修正题设。",
    GEOMETRY_SCHEMA_FIELDS: "模型已返回JSON，但几何对象或角名字段的结构不符合约定；未猜测缺失信息。",
    GEOMETRY_SCHEMA_LABEL: "模型返回的角编号缺失或格式不符合约定，须为非空短字符串；未改写编号。",
    GEOMETRY_SCHEMA_VERTEX: "模型返回的角顶点缺失或点名格式不符合约定；未猜测顶点。",
    GEOMETRY_SCHEMA_ARMS: "模型返回的角射线字段不符合约定，须含恰好两个合法经过点名；未补造端点。",
    GEOMETRY_CONFLICT: "模型返回的角名、顶点或射线写法互相矛盾；未擅自选择其中一套条件。",
    GEOMETRY_DUPLICATE_LABEL: "模型重复返回同一编号角，无法安全对应题图；未合并或删除角信息。",
    GEOMETRY_DEGENERATE_ANGLE: "模型返回的角顶点与射线经过点重合，或两条射线使用同一点；未采用退化角。",
    GEOMETRY_SCHEMA_LIMIT: "模型返回的几何证据数量或长度超过支持范围；未截断题设。",
    GEOMETRY_SCHEMA_UNCERTAINTIES: "模型返回的角标待核对说明格式不符合约定，须为非空文本组成的数组。",
    JSON_TOO_LARGE: "模型正文超过结构化解析大小限制。",
    ENVELOPE_INVALID: "接口响应外层不是约定格式，无法提取模型正文。",
    RESPONSE_EMPTY: "接口已返回，但没有可用的最终正文。",
    REASONING_ONLY: "接口只返回了思考字段，没有最终正文；思考内容未作为答案使用。",
    OUTPUT_TRUNCATED: "接口报告输出已被截断；没有把残缺内容当成完整结果。",
    OUTPUT_FILTERED: "接口报告输出被过滤或拒绝，未得到可用答案。",
    PROVIDER_FAILED: "接口明确报告生成失败，未使用残缺正文。",
    TIMEOUT_BEFORE_HEADERS: "到达调用时限前未收到响应头；服务端是否完成未知，未向本模型重发。",
    TIMEOUT_READING_BODY: "已收到响应头，但读取完整正文时超时；服务端是否完成未知，未向本模型重发。",
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
    requestBytes?: number;
    dnsMs?: number;
    requestCreatedMs?: number;
    requestHeadersMs?: number;
    requestSentMs?: number;
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
    if(bounded(v.requestBytes,128*1024*1024))out.requestBytes=v.requestBytes;
    for(const key of ["dnsMs","requestCreatedMs","requestHeadersMs","requestSentMs","headersMs","firstByteMs","lastByteMs"] as const)if(bounded(v[key],3600000))out[key]=v[key];
    return out;
}
