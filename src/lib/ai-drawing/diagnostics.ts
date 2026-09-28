import { diagnosticMessage } from "../ai/diagnostics";

/** Public fixed messages only: never display raw upstream errors, URLs or config values. */
const drawingErrors: Record<string, string> = {
    AI_DRAWING_UNSUPPORTED: diagnosticMessage("DRAWING_UNSUPPORTED")!,
    AI_DRAWING_INVALID: diagnosticMessage("DRAWING_INVALID")!,
    AI_RESPONSE_ERROR: "模型未返回可用的构造结果，请到本次任务查看格式或输出诊断。",
    AI_NO_VISION_MODEL: "原题底图重建需要可用的识图模型；有原图时不会降级为纯文字猜图。请检查识图调用顺序、vision能力与账号授权。",
    AI_NO_TEXT_MODEL: "当前账号没有可用的解题模型。请检查解题调用顺序、模型是否启用及账号可用模型权限；无需启用图片编辑。",
    AI_RATE_LIMIT: "模型接口处于限流或冷却期，本次未获得作图结果。请先核对调用记录与额度。",
    AI_BUDGET_EXHAUSTED: "本次作图的调用次数或总时限已用尽，请查看本次任务中各次调用的具体原因。",
    AI_ENDPOINT_REJECTED: "模型地址未通过发送前的安全校验。请检查公网HTTPS地址、DNS与协议路径。",
    AI_IMAGE_EDIT_UNSUPPORTED: "原图编辑需要管理员单独指定支持Gemini图片输出的模型；能识图不代表能编辑图片。",
    AI_IMAGE_EDIT_SETTINGS_CHANGED: "图片编辑设置已变更或原模型已不可用，请重新读取设置并确认模型。",
    AI_IMAGE_EDIT_NO_IMAGE: "图片编辑接口没有返回可用图片，可能只返回了文字或拒绝生成。请核对所选模型的图片输出能力，不要连续重发。",
    AI_IMAGE_EDIT_INVALID_IMAGE: "图片编辑接口返回的图片无法解码，或尺寸、格式超出安全限制；未把无效图片作为结果。",
    AI_IMAGE_EDIT_INVALID_INPUT: "原图编辑缺少有效原图、构造方案或人工确认，请先核对并完成分步构造。",
    AI_ACCEPTANCE_UNKNOWN: "无法确认上游是否已经完成作图，可能已经计费；不要重复提交，请先查看本次任务与调用记录。",
    AI_REQUEST_TIMEOUT_CHECK_TASKS: "等待任务响应超时，不代表后台已停止。不要重复提交，请先到我的AI任务核对受理和完成状态。",
    AI_POLLING_STOPPED_JOB_CONTINUES: "页面已停止等待，但后台任务可能仍在继续。请从本次任务链接取回结果，不要重复提交。",
    AI_ACCESS_REVOKED: "账号或模型使用权限已变更，请刷新并确认仍有权使用该模型。",
    AI_CANCELLED: "作图任务已取消，请查看调用记录确认上游处理状态。",
    AI_QUEUE_FULL: "作图任务队列已满，请先查看已有任务，避免重复提交。",
};
export function drawingFailureMessage(code: unknown, diagnostic?: unknown): string {
    const detail = diagnosticMessage(diagnostic) || (typeof code === "string" && Object.hasOwn(drawingErrors, code) ? drawingErrors[code] : undefined);
    return detail
        ? (code === "AI_BUDGET_EXHAUSTED" && diagnosticMessage(diagnostic) ? "作图调用预算已用尽。最后一次调用：" : "") + detail + " 请查看本次任务或我的AI任务/调用记录，不要连续重发。"
        : "作图未确认完成。请到我的AI任务核对错误与调用记录，不要连续重发。";
}
