import type { AIProvider, AIModel } from "../ai-config/schema";
import { AIUrlError } from "../ai-url";
import type { AIDiagnostic } from "./diagnostics";
export class AIError extends Error {
    constructor(
        public code: string,
        public fallback = false,
        public retryAfterMs = 0,
        public diagnostic?: AIDiagnostic,
    ) {
        super(code);
    }
}
export function buildRequest(
    p: AIProvider,
    m: AIModel,
    prompt: string,
    text: string,
    image?: string,
    detailImages: string[] = [],
    profile?: "transcription",
) {
    let base = p.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    let body: Record<string, unknown>;
    let url: string;
    const chatContent: unknown[] = [
        { type: "text", text: text || "请识别题目并正确解答。" },
    ];
    const images=image ? [image,...detailImages.slice(0,3)] : [];
    for(const img of images) chatContent.push({ type: "image_url", image_url: { url: img } });
    if (p.protocol === "gemini") {
        base = base.replace(/\/v1(?:beta)?$/, "");
        url = `${base}/v1beta/models/${encodeURIComponent(m.model.replace(/^models\//, ""))}:generateContent`;
        headers["x-goog-api-key"] = p.apiKey;
        const parts: unknown[] = [{ text: text || "请识别题目并解答。" }];
        for (const img of images) {
            const match = img.match(
                /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/,
            );
            if (!match) throw new AIError("INVALID_IMAGE");
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
        body = {
            systemInstruction: { parts: [{ text: prompt }] },
            contents: [{ role: "user", parts }],
        };
    } else if (p.protocol === "responses" || p.protocol === "responses_codex") {
        base = base.replace(/\/chat\/completions$/, "/responses");
        url = base.endsWith("/responses")
            ? base
            : `${new URL(base).pathname === "/" ? `${base}/v1` : base}/responses`;
        headers.Authorization = `Bearer ${p.apiKey}`;
        headers.Accept = "text/event-stream";
        const content: unknown[] = [
            { type: "input_text", text: text || "请识别题目并解答。" },
        ];
        for(const img of images) content.push({ type: "input_image", image_url: img });
        body = {
            model: m.model,
            input: [
                {
                    type: "message",
                    role: "developer",
                    content: [{ type: "input_text", text: prompt }],
                },
                { type: "message", role: "user", content },
            ],
            stream: true,
            store: false,
        };
    } else {
        if (p.protocol === "azure") {
            url = `${base}/openai/deployments/${encodeURIComponent(m.model)}/chat/completions?api-version=${encodeURIComponent(p.apiVersion || "2024-10-21")}`;
            headers["api-key"] = p.apiKey;
        } else {
            url = base.endsWith("/chat/completions")
                ? base
                : `${new URL(base).pathname === "/" ? `${base}/v1` : base}/chat/completions`;
            headers.Authorization = `Bearer ${p.apiKey}`;
        }
        body = {
            model: m.model,
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: chatContent },
            ],
            stream: profile === "transcription",
        };
    }
    if (body.stream === true) headers.Accept = "text/event-stream";
    return { url, headers, body };
}
type ResponsesPayload = {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};
function responseText(v: ResponsesPayload) {
    if (!v || typeof v !== "object" || (v.output !== undefined && !Array.isArray(v.output)))
        throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
    if (typeof v.output_text === "string") return v.output_text;
    const texts: string[] = [];
    for (const item of v.output || []) {
        if (!item || typeof item !== "object" || (item.content !== undefined && !Array.isArray(item.content)))
            throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
        for (const part of item.content || []) {
            if (!part || typeof part !== "object") throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
            if (part.type === "output_text") {
                if (typeof part.text !== "string") throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
                texts.push(part.text);
            }
        }
    }
    return texts.join("");
}
function interrupted(signal: AbortSignal | undefined, duringBody: boolean): AIDiagnostic {
    if (signal?.aborted) {
        if (signal.reason?.name === "TimeoutError") return duringBody ? "TIMEOUT_READING_BODY" : "TIMEOUT_BEFORE_HEADERS";
        return duringBody ? "CANCELLED_READING_BODY" : "CANCELLED_BEFORE_HEADERS";
    }
    return duringBody ? "NETWORK_READING_BODY" : "NETWORK_BEFORE_HEADERS";
}
export async function decodeResponse(
    res: Response,
    protocol: AIProvider["protocol"],
    signal?: AbortSignal,
): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) throw new AIError("AI_RESPONSE_ERROR", true, 0, "RESPONSE_EMPTY");
    const decoder = new TextDecoder();
    const streaming = res.headers
        .get("content-type")?.toLowerCase().includes("text/event-stream");
    let text = "";
    let size = 0;
    let delta = "";
    let hasReasoning = false;
    let ended = false;
    const eventText = (block: string): string | undefined => {
        const data = block.split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") return;
        let event;
        try {
            event = JSON.parse(data);
        } catch {
            throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INVALID");
        }
        if (!event || typeof event !== "object")
            throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INVALID");
        if (protocol === "chat" || protocol === "azure") {
            if (event.error) throw new AIError("AI_RESPONSE_ERROR", true, 0, "PROVIDER_FAILED");
            if (!Array.isArray(event.choices)) throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INVALID");
            // Empty choices can carry usage; only choice zero belongs to this request.
            if (!event.choices.length) return;
            const choice = event.choices.find((c: { index?: number } | null) => c?.index === 0);
            if (!choice || !choice.delta || typeof choice.delta !== "object")
                throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INVALID");
            const chunk = choice.delta;
            if (typeof chunk.reasoning_content === "string" && chunk.reasoning_content.trim()) hasReasoning = true;
            if (chunk.refusal) throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_FILTERED");
            if (chunk.content != null) {
                if (typeof chunk.content !== "string") throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INVALID");
                delta += chunk.content;
            }
            const reason = choice.finish_reason;
            if (reason === "length") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_TRUNCATED");
            if (reason === "content_filter") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_FILTERED");
            if (reason != null && reason !== "stop") throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
            if (reason === "stop") {
                if (!delta.trim()) throw new AIError("AI_RESPONSE_ERROR", true, 0, hasReasoning ? "REASONING_ONLY" : "RESPONSE_EMPTY");
                return delta;
            }
            return;
        }
        if (["error", "response.failed", "response.incomplete"].includes(event.type))
            throw new AIError("AI_RESPONSE_ERROR", true, 0, event.type === "response.incomplete" ? "OUTPUT_TRUNCATED" : "PROVIDER_FAILED");
        if (event.type === "response.output_text.delta" && typeof event.delta === "string")
            delta += event.delta;
        if (event.type === "response.completed") {
            if (event.response?.status && event.response.status !== "completed")
                throw new AIError("AI_RESPONSE_ERROR", true, 0, event.response.status === "incomplete" ? "OUTPUT_TRUNCATED" : "PROVIDER_FAILED");
            const result = responseText(event.response || {}) || delta;
            if (!result.trim()) throw new AIError("AI_RESPONSE_ERROR", true, 0, "RESPONSE_EMPTY");
            return result;
        }
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                ended = true;
                text += decoder.decode();
                break;
            }
            size += value.byteLength;
            if (size > 4 * 1024 * 1024)
                throw new AIError("AI_RESPONSE_TOO_LARGE", true);
            text += decoder.decode(value, { stream: true });
            if (streaming) {
                let boundary;
                while ((boundary = /\r?\n\r?\n/.exec(text))) {
                    const block = text.slice(0, boundary.index);
                    text = text.slice(boundary.index + boundary[0].length);
                    const result = eventText(block);
                    if (result !== undefined) return result;
                }
            }
        }
        // Deltas, [DONE], or a truncated terminal frame do not prove completion.
        if (streaming) throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, "STREAM_INCOMPLETE");
    } catch (e) {
        if (e instanceof AIError) throw e;
        throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, interrupted(signal, true));
    } finally {
        if (!ended) void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    let v;
    try {
        v = JSON.parse(text);
    } catch {
        throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
    }
    if (!v || typeof v !== "object" || Array.isArray(v))
        throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
    if (protocol.startsWith("responses")) {
        if (v.status === "incomplete") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_TRUNCATED");
        if (v.status && v.status !== "completed") throw new AIError("AI_RESPONSE_ERROR", true, 0, "PROVIDER_FAILED");
    } else if (protocol === "gemini") {
        const parts = v.candidates?.[0]?.content?.parts;
        if (parts !== undefined && (!Array.isArray(parts) || parts.some((part: unknown) => !part || typeof part !== "object" ||
            ("text" in part && typeof part.text !== "string"))))
            throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
        const reason = v.candidates?.[0]?.finishReason;
        if (reason === "MAX_TOKENS") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_TRUNCATED");
        if (reason && reason !== "STOP") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_FILTERED");
    } else {
        const choice = v.choices?.[0];
        if (!choice?.message || typeof choice.message !== "object")
            throw new AIError("AI_RESPONSE_ERROR", true, 0, "ENVELOPE_INVALID");
        if (choice.finish_reason === "length") throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_TRUNCATED");
        if (choice.finish_reason === "content_filter" || choice.message.refusal)
            throw new AIError("AI_RESPONSE_ERROR", true, 0, "OUTPUT_FILTERED");
        if ((!choice.message.content || (typeof choice.message.content === "string" && !choice.message.content.trim())) && typeof choice.message.reasoning_content === "string" && choice.message.reasoning_content.trim())
            throw new AIError("AI_RESPONSE_ERROR", true, 0, "REASONING_ONLY");
    }
    const output =
        protocol === "gemini"
            ? v.candidates?.[0]?.content?.parts
                  ?.map((p: { text?: string }) => p.text || "")
                  .join("")
            : protocol.startsWith("responses")
              ? responseText(v)
              : v.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim())
        throw new AIError("AI_RESPONSE_ERROR", true, 0, "RESPONSE_EMPTY");
    return output;
}
export async function sendAI(
    p: AIProvider,
    m: AIModel,
    prompt: string,
    text: string,
    image: string | undefined,
    signal: AbortSignal,
    detailImages: string[] = [],
    profile?: "transcription",
): Promise<string> {
    const request = buildRequest(p, m, prompt, text, image, detailImages, profile);
    let responseReceived = false;
    try {
        const { withSafeAIResponse } = await import("../ai-url");
        return await withSafeAIResponse(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal,
            redirect: "error",
        }, async (res) => {
            responseReceived = true;
            if (!res.ok) {
                const after = res.headers.get("retry-after");
                const ms = after
                    ? Number.isFinite(Number(after))
                        ? Number(after) * 1000
                        : Date.parse(after) - Date.now()
                    : 60000;
                throw new AIError(
                    res.status === 429
                        ? "AI_RATE_LIMIT"
                        : res.status === 401 || res.status === 403
                          ? "AI_AUTH_ERROR"
                          : `AI_HTTP_${res.status}`,
                    true,
                    res.status === 429
                        ? Math.min(900000, Math.max(1000, ms || 60000))
                        : 0,
                );
            }
            return await decodeResponse(res, p.protocol, signal);
        });
    } catch (e) {
        if (e instanceof AIError) throw e;
        // Only the URL gate proves rejection before dispatch. Network failures remain unknown.
        if (e instanceof AIUrlError)
            throw new AIError("AI_ENDPOINT_REJECTED", true);
        throw new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, interrupted(signal, responseReceived));
    }
}
