import type { AIProvider, AIModel } from "../ai-config/schema";
import { AIUrlError } from "../ai-url";
export class AIError extends Error {
    constructor(
        public code: string,
        public fallback = false,
        public retryAfterMs = 0,
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
    if (image)
        chatContent.push({ type: "image_url", image_url: { url: image } });
    if (p.protocol === "gemini") {
        base = base.replace(/\/v1(?:beta)?$/, "");
        url = `${base}/v1beta/models/${encodeURIComponent(m.model.replace(/^models\//, ""))}:generateContent`;
        headers["x-goog-api-key"] = p.apiKey;
        const parts: unknown[] = [{ text: text || "请识别题目并解答。" }];
        if (image) {
            const match = image.match(
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
        if (image) content.push({ type: "input_image", image_url: image });
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
            stream: false,
        };
    }
    return { url, headers, body };
}
type ResponsesPayload = {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};
function responseText(v: ResponsesPayload) {
    return typeof v.output_text === "string"
        ? v.output_text
        : (v.output || [])
              .flatMap((o) => o.content || [])
              .filter((c) => c.type === "output_text")
              .map((c) => c.text || "")
              .join("");
}
export async function decodeResponse(
    res: Response,
    protocol: AIProvider["protocol"],
): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) throw new AIError("AI_RESPONSE_ERROR", true);
    const decoder = new TextDecoder();
    let text = "",
        size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 4 * 1024 * 1024) {
                await reader.cancel();
                throw new AIError("AI_RESPONSE_TOO_LARGE", true);
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    } catch (e) {
        if (e instanceof AIError) throw e;
        throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    }
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
        let delta = "",
            complete = false,
            result = "";
        for (const block of text.split(/\r?\n\r?\n/)) {
            const data = block
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trimStart())
                .join("\n");
            if (!data || data === "[DONE]") continue;
            let event;
            try {
                event = JSON.parse(data);
            } catch {
                throw new AIError("AI_ACCEPTANCE_UNKNOWN");
            }
            if (event.type === "error" || event.type === "response.failed")
                throw new AIError("AI_RESPONSE_ERROR", true);
            if (event.type === "response.output_text.delta")
                delta += event.delta || "";
            if (event.type === "response.completed") {
                complete = true;
                result = responseText(event.response || {});
                if (
                    event.response?.status &&
                    event.response.status !== "completed"
                )
                    throw new AIError("AI_RESPONSE_ERROR", true);
            }
        }
        if (!complete) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        if (!(result || delta)) throw new AIError("AI_RESPONSE_ERROR", true);
        return result || delta;
    }
    let v;
    try {
        v = JSON.parse(text);
    } catch {
        throw new AIError("AI_RESPONSE_ERROR", true);
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
        throw new AIError("AI_RESPONSE_ERROR", true);
    return output;
}
export async function sendAI(
    p: AIProvider,
    m: AIModel,
    prompt: string,
    text: string,
    image: string | undefined,
    signal: AbortSignal,
): Promise<string> {
    const request = buildRequest(p, m, prompt, text, image);
    try {
        const { safeAIFetch } = await import("../ai-url");
        const res = await safeAIFetch(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal,
            redirect: "error",
        });
        if (!res.ok) {
            await res.body?.cancel();
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
        return await decodeResponse(res, p.protocol);
    } catch (e) {
        if (e instanceof AIError) throw e;
        // Only the URL gate proves rejection before dispatch. Network failures remain unknown.
        if (e instanceof AIUrlError)
            throw new AIError("AI_ENDPOINT_REJECTED", true);
        throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    }
}
