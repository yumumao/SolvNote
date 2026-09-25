// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendAI } from "@/lib/ai/transport";

// Real request builder + DNS gate + bounded transport + parser; no network or keys.
const network = vi.hoisted(() => ({
    lookup: vi.fn(), fetch: vi.fn(), close: vi.fn(), destroy: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
    Client: class { constructor() { throw new Error("Unexpected proxy in direct-mode fixture"); } },
    fetch: network.fetch,
    Agent: class { close = network.close; destroy = network.destroy; },
}));
const provider = {
    id: "p", name: "Synthetic", protocol: "responses" as const,
    baseUrl: "https://example.com/v1", apiKey: "synthetic", enabled: true,
};
const model = {
    id: "m", providerId: "p", model: "unit", name: "Synthetic",
    enabled: true, capabilities: ["text", "vision"] as ("text" | "vision")[],
};
beforeEach(() => {
    vi.resetAllMocks();
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.close.mockResolvedValue(undefined);
    network.destroy.mockResolvedValue(undefined);
});

/** A proxy that sends its event but keeps HTTP open until the request deadline. */
function holdOpen(text: string, options: { status?: number; splitBytes?: boolean } = {}) {
    const cancel = vi.fn();
    network.fetch.mockImplementation(async (_url, init) => {
        const signal = init.signal as AbortSignal;
        let onAbort: () => void;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                const bytes = new TextEncoder().encode(text);
                if (options.splitBytes) {
                    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                } else if (bytes.length) controller.enqueue(bytes);
                onAbort = () => controller.error(new Error("synthetic secret must not leak"));
                signal.addEventListener("abort", onAbort, { once: true });
            },
            cancel() {
                signal.removeEventListener("abort", onAbort);
                cancel();
            },
        });
        return new Response(body, {
            status: options.status || 200,
            headers: { "Content-Type": "text/event-stream", "Retry-After": "120" },
        });
    });
    return cancel;
}
function call() {
    return sendAI(provider, model, "synthetic rule", "synthetic question", undefined, AbortSignal.timeout(300));
}

describe("Responses terminal events do not wait for HTTP EOF", () => {
    it("returns the completed answer and cancels the still-open provider body", async () => {
        const cancel = holdOpen('data: {"type":"response.completed","response":{"status":"completed","output_text":"complete answer"}}\n\n');
        await expect(call()).resolves.toBe("complete answer");
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(network.destroy).toHaveBeenCalledTimes(1);
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });
    it("handles split UTF-8, CRLF, comments and multiline data with delta fallback", async () => {
        const cancel = holdOpen(': heartbeat\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"几何题完整答案"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n', { splitBytes: true });
        await expect(call()).resolves.toBe("几何题完整答案");
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it.each(["response.failed", "response.incomplete", "error"])("stops promptly on %s without accepting partial output or leaking details", async (type) => {
        const cancel = holdOpen(`data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: ${JSON.stringify({ type, response: { status: "incomplete" }, error: { message: "synthetic secret" } })}\n\n`);
        await expect(call()).rejects.toMatchObject({ code: "AI_RESPONSE_ERROR", fallback: true, message: "AI_RESPONSE_ERROR" });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(network.destroy).toHaveBeenCalledTimes(1);
    });
    it("handles an HTTP rejection without waiting for its error body", async () => {
        const cancel = holdOpen("", { status: 429 });
        await expect(call()).rejects.toMatchObject({ code: "AI_RATE_LIMIT", fallback: true, retryAfterMs: 120000 });
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it("keeps an unterminated stream unknown, rather than treating deltas as an answer", async () => {
        holdOpen('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
        await expect(call()).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN", fallback: false });
        expect(network.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("stream safety and compatibility", () => {
    it("uses the completed output array instead of an earlier delta", async () => {
        holdOpen('data: {"type":"response.output_text.delta","delta":"earlier"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"content":[{"type":"output_text","text":"final"}]}]}}\n\n');
        await expect(call()).resolves.toBe("final");
    });
    it.each([
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: [DONE]\n\n',
        'data: {"type":"response.completed","response":{"output_text":"truncated frame"}}',
        'data: not-json\n\n',
    ])("does not accept incomplete/malformed SSE case %#", async (text) => {
        network.fetch.mockResolvedValue(new Response(text, { headers: { "Content-Type": "text/event-stream" } }));
        await expect(call()).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN", fallback: false });
    });
    it.each([
        { status: "incomplete", output_text: "partial" },
        { status: "failed", output_text: "partial" },
        { status: "completed", output_text: " " },
    ])("rejects a contradictory or empty completion case %#", async (response) => {
        holdOpen(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`);
        await expect(call()).rejects.toMatchObject({ code: "AI_RESPONSE_ERROR", fallback: true });
    });
    it.each([[401, "AI_AUTH_ERROR"], [403, "AI_AUTH_ERROR"], [503, "AI_HTTP_503"]])("classifies HTTP %s without draining the body", async (status, code) => {
        const cancel = holdOpen("", { status: Number(status) });
        await expect(call()).rejects.toMatchObject({ code, fallback: true });
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it("enforces the existing actual-byte limit for streamed responses", async () => {
        const cancel = holdOpen(`: ${"x".repeat(2 * 1024 * 1024)}\n\n`);
        await expect(call()).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN", fallback: false });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(network.destroy).toHaveBeenCalledTimes(1);
    });
    it("does not wait for an upstream cancel promise to settle", async () => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        network.fetch.mockResolvedValue(new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"output_text":"ok"}}\n\n')); },
            cancel,
        }), { headers: { "Content-Type": "text/event-stream" } }));
        await expect(call()).resolves.toBe("ok");
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(network.destroy).toHaveBeenCalledTimes(1);
    });
    it("sanitizes read/cancel/dispatcher failures", async () => {
        network.fetch.mockResolvedValue(new Response(new ReadableStream({
            pull() { throw new Error("synthetic secret"); },
            cancel() { throw new Error("synthetic secret"); },
        })));
        network.destroy.mockRejectedValue(new Error("synthetic secret"));
        await expect(call()).rejects.toMatchObject({ message: "AI_ACCEPTANCE_UNKNOWN", fallback: false });
    });
    it("does not dispatch an already-cancelled request", async () => {
        await expect(sendAI(provider, model, "rule", "question", undefined, AbortSignal.abort())).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");
        expect(network.fetch).not.toHaveBeenCalled();
        // Pre-aborted work must not resolve DNS or allocate a dispatcher.
        expect(network.destroy).not.toHaveBeenCalled();
    });
    it("preserves buffered JSON completion and orderly dispatcher shutdown", async () => {
        network.fetch.mockResolvedValue(Response.json({ output_text: "json answer" }));
        await expect(call()).resolves.toBe("json answer");
        expect(network.close).toHaveBeenCalledTimes(1);
        expect(network.destroy).not.toHaveBeenCalled();
    });
});
