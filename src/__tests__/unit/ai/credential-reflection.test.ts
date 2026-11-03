// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@/lib/ai-config/schema";
import { sendAI } from "@/lib/ai/transport";

const fixtures = vi.hoisted(() => ({ response: undefined as Response | undefined, log: vi.fn() }));
vi.mock("@/lib/ai-url", () => ({
    AIUrlError: class AIUrlError extends Error {},
    withSafeAIResponse: async (_url: string, _init: RequestInit, consume: (response: Response) => Promise<unknown>) => {
        if (!fixtures.response) throw Error("Missing synthetic upstream");
        return consume(fixtures.response);
    },
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: fixtures.log }) }));
vi.mock("@/lib/config", () => ({ getAppConfig: vi.fn() }));
vi.mock("@/lib/ai/tag-service", () => ({ getMathTagsFromDB: vi.fn(), getTagsFromDB: vi.fn() }));
vi.mock("openai", () => ({ default: class {}, AzureOpenAI: class {} }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));

// Synthetic only. Intentionally includes characters whose transport representations differ.
const credential = "fixture/only+credential=abCd987654321";
const provider: AIProvider = { id: "p", name: "Fixture", protocol: "chat", baseUrl: "https://example.com/v1", apiKey: credential, enabled: true };
const model = { id: "m", providerId: "p", name: "Fixture", model: "fixture", enabled: true, capabilities: ["text"] as "text"[] };
const protocols: AIProvider["protocol"][] = ["chat", "azure", "gemini", "responses", "responses_codex"];

function response(text: string, protocol: AIProvider["protocol"] = "chat") {
    const body = protocol === "gemini" ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }
        : protocol.startsWith("responses") ? { status: "completed", output_text: text }
            : { choices: [{ finish_reason: "stop", message: { content: text } }] };
    fixtures.response = new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
function call(protocol: AIProvider["protocol"] = "chat", apiKey = credential) {
    return sendAI({ ...provider, protocol, apiKey }, model, "Synthetic rule", "Synthetic question", undefined, new AbortController().signal);
}
async function rejectsCredential(protocol: AIProvider["protocol"] = "chat", apiKey = credential) {
    const result = await call(protocol, apiKey).then(value => ({ value }), error => ({ error }));
    expect(result).toHaveProperty("error");
    if (!("error" in result)) return;
    expect(result.error).toMatchObject({ code: "AI_RESPONSE_ERROR", message: "AI_RESPONSE_ERROR", fallback: false });
    expect(JSON.stringify(result.error)).not.toContain(credential);
    expect(JSON.stringify(fixtures.log.mock.calls)).not.toContain(credential);
}
beforeEach(() => { fixtures.response = undefined; fixtures.log.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("provider credentials cannot return as a successful answer", () => {
    it.each(protocols)("blocks a complete credential in %s output", async protocol => {
        response(`<answer_text>${credential}</answer_text><analysis>Fixture</analysis>`, protocol);
        await rejectsCredential(protocol);
    });
    const representations = [
        ["JSON unicode", [...credential].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")],
        ["JSON slash", credential.replaceAll("/", "\\/")],
        ["percent", encodeURIComponent(credential)],
        ["double percent", encodeURIComponent(encodeURIComponent(credential))],
        ["base64", Buffer.from(credential).toString("base64")],
        ["unpadded base64", Buffer.from(credential).toString("base64").replace(/=+$/, "")],
        ["base64url", Buffer.from(credential).toString("base64url")],
        ["hex", Buffer.from(credential).toString("hex")],
        ["uppercase hex", Buffer.from(credential).toString("hex").toUpperCase()],
    ];
    it.each(representations)("blocks the complete %s representation", async (_name, encoded) => {
        response(`{"answer_text":"${encoded}","analysis":"Fixture"}`);
        await rejectsCredential();
    });
    it.each(["chat", "azure", "responses", "responses_codex"] as const)("blocks a %s SSE credential split across events", async protocol => {
        const first = credential.slice(0, 17), second = credential.slice(17);
        const events = protocol === "chat" || protocol === "azure" ? [
            { choices: [{ index: 0, delta: { content: first }, finish_reason: null }] },
            { choices: [{ index: 0, delta: { content: second }, finish_reason: "stop" }] },
        ] : [
            { type: "response.output_text.delta", delta: first },
            { type: "response.output_text.delta", delta: second },
            { type: "response.completed", response: { status: "completed" } },
        ];
        fixtures.response = new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
        await rejectsCredential(protocol);
    });
    it("blocks a complete short credential returned alone", async () => { response(" k "); await rejectsCredential("chat", "k"); });
    it.each(["Authorization: Bearer k", '{"apiKey":"k"}', 'x-goog-api-key: k'])("blocks an explicitly labelled short credential: %s", async text => {
        response(text); await rejectsCredential("chat", "k");
    });
    it.each(["k", "key", "test-key", "synthetic"])("does not substring-match a short fixture credential %s in ordinary text", async apiKey => {
        const answer = "A monkey uses the key idea in a synthetic example; test-keyboard is a label.";
        response(answer); await expect(call("chat", apiKey)).resolves.toBe(answer);
    });
    it("leaves normal structured answers and partial credential-looking text unchanged", async () => {
        const answer = `{"answer_text":"2","analysis":"\\frac{1}{2}; ${credential.slice(0, 8)} is a partial fixture label."}`;
        response(answer); await expect(call()).resolves.toBe(answer);
    });
    it("allows unauthenticated public providers with an empty credential", async () => {
        response("Correct answer"); await expect(call("chat", "")).resolves.toBe("Correct answer");
    });
    it("does not parse or expose an HTTP error body containing a credential", async () => {
        fixtures.response = new Response(credential, { status: 401 });
        await expect(call()).rejects.toMatchObject({ code: "AI_AUTH_ERROR", message: "AI_AUTH_ERROR" });
    });
});

describe("legacy constructors do not log credential fragments", () => {
    it.each(["openai", "gemini", "azure"])("omits key prefixes in the %s constructor", async protocol => {
        if (protocol === "openai") {
            const { OpenAIProvider } = await import("@/lib/ai/openai-provider");
            new OpenAIProvider({ apiKey: credential });
        } else if (protocol === "gemini") {
            const { GeminiProvider } = await import("@/lib/ai/gemini-provider");
            new GeminiProvider({ apiKey: credential });
        } else {
            const { AzureOpenAIProvider } = await import("@/lib/ai/azure-provider");
            new AzureOpenAIProvider({ apiKey: credential, endpoint: "https://example.com", deploymentName: "fixture" });
        }
        expect(fixtures.log).toHaveBeenCalledOnce();
        expect(JSON.stringify(fixtures.log.mock.calls)).not.toContain(credential.slice(0, 8));
        expect(fixtures.log.mock.calls[0][0]).not.toHaveProperty("apiKeyPrefix");
    });
});
