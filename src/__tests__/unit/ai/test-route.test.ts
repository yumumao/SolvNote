// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    session: vi.fn(),
    user: vi.fn(),
    fetch: vi.fn(),
    get: vi.fn(),
    log: vi.fn(),
    provider: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
    prisma: { user: { findUnique: mocks.user } },
}));
vi.mock("@/lib/config", () => ({ getAppConfig: mocks.get }));
vi.mock("@/lib/logger", () => ({
    createLogger: () => ({
        error: mocks.log,
        info: mocks.log,
        warn: mocks.log,
    }),
}));
vi.mock("@/lib/ai-url", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/ai-url")>()),
    safeAIFetch: mocks.fetch,
}));
// Fail-closed test doubles: the old providers must never perform real AI calls.
vi.mock("@/lib/ai/openai-provider", () => ({ OpenAIProvider: mocks.provider }));
vi.mock("@/lib/ai/gemini-provider", () => ({ GeminiProvider: mocks.provider }));
vi.mock("@/lib/ai/azure-provider", () => ({
    AzureOpenAIProvider: mocks.provider,
}));
import { POST } from "@/app/api/ai/test/route";
const payload = {
    provider: "openai",
    apiKey: "fixture-request-key",
    baseUrl: "https://api.example.com/v1",
    model: "demo",
};
const request = (
    body: unknown = payload,
    headers: Record<string, string> = {},
) =>
    new Request("https://app.example.com/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    mocks.user.mockResolvedValue({ id: "u1", role: "admin", isActive: true });
    mocks.fetch.mockResolvedValue(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
    );
    mocks.get.mockReturnValue({
        openai: {
            instances: [
                {
                    id: "one",
                    apiKey: "fixture-stored-key",
                    baseUrl: payload.baseUrl,
                    model: "demo",
                },
            ],
        },
        azure: {
            apiKey: "fixture-azure-key",
            endpoint: "https://azure.example.com",
            deploymentName: "demo",
        },
    });
});
describe("/api/ai/test security", () => {
    it("rejects anonymous requests", async () => {
        mocks.session.mockResolvedValue(null);
        expect((await POST(request())).status).toBe(401);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each([
        { id: "u1", role: "user", isActive: true },
        { id: "u1", role: "admin", isActive: false },
        null,
    ])("uses DB role/active state: %j", async (user) => {
        mocks.user.mockResolvedValue(user);
        expect((await POST(request())).status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.provider).not.toHaveBeenCalled();
    });
    it("blocks same-site but cross-origin browsers", async () => {
        expect(
            (await POST(request(payload, { "Sec-Fetch-Site": "same-site" })))
                .status,
        ).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("uses only the guarded transport, returning capability flags rather than provider data", async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            success: true,
            textSupport: true,
            visionSupport: true,
            modelInfo: "demo",
        });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
        expect(mocks.fetch.mock.calls[0][0]).toBe(
            "https://api.example.com/v1/chat/completions",
        );
        expect(
            new Headers(mocks.fetch.mock.calls[0][1].headers).get(
                "authorization",
            ),
        ).toBe("Bearer fixture-request-key");
        expect(mocks.provider).not.toHaveBeenCalled();
    });
    it("only falls back to a text probe for a capability rejection", async () => {
        mocks.fetch.mockResolvedValueOnce(
            new Response("fixture-provider-error", { status: 400 }),
        );
        const response = await POST(request());
        expect(await response.json()).toMatchObject({
            success: true,
            textSupport: true,
            visionSupport: false,
            visionError: "VISION_NOT_SUPPORTED",
        });
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });
    it("does not spend another request after authentication failure", async () => {
        mocks.fetch.mockResolvedValueOnce(
            new Response("fixture-provider-error", { status: 401 }),
        );
        const response = await POST(request());
        expect(await response.json()).toMatchObject({
            success: false,
            textError: "AI_AUTH_ERROR",
            visionError: "AI_AUTH_ERROR",
        });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
    it("supports the Gemini header-based protocol", async () => {
        mocks.fetch.mockResolvedValue(
            Response.json({
                candidates: [{ content: { parts: [{ text: "OK" }] } }],
            }),
        );
        const response = await POST(
            request({
                provider: "gemini",
                apiKey: payload.apiKey,
                model: "gemini-demo",
            }),
        );
        expect((await response.json()).success).toBe(true);
        expect(mocks.fetch.mock.calls[0][0]).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-demo:generateContent",
        );
        expect(
            new Headers(mocks.fetch.mock.calls[0][1].headers).get(
                "x-goog-api-key",
            ),
        ).toBe(payload.apiKey);
    });
    it("supports Azure with masked keys bound to the stored endpoint", async () => {
        const response = await POST(
            request({
                provider: "azure",
                apiKey: "********",
                endpoint: "https://azure.example.com",
                deploymentName: "demo",
            }),
        );
        expect((await response.json()).success).toBe(true);
        expect(mocks.fetch.mock.calls[0][0]).toContain(
            "https://azure.example.com/openai/deployments/demo/chat/completions?api-version=",
        );
        expect(
            new Headers(mocks.fetch.mock.calls[0][1].headers).get("api-key"),
        ).toBe("fixture-azure-key");
    });
    it("does not send a stored key to a changed endpoint", async () => {
        const response = await POST(
            request({
                ...payload,
                apiKey: "********",
                baseUrl: "https://evil.example.com",
            }),
        );
        expect(response.status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each([
        { ...payload, provider: "unknown" },
        { ...payload, proxy: "internal" },
        { provider: "azure", apiKey: "fixture-key" },
    ])("rejects malformed configuration case %#", async (body) => {
        expect((await POST(request(body))).status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("caps input size", async () => {
        expect(
            (await POST(request({ ...payload, model: "x".repeat(70000) })))
                .status,
        ).toBe(413);
    });
    it("does not leak arbitrary provider errors in logs or responses", async () => {
        mocks.fetch.mockRejectedValue(new Error("fixture-provider-secret"));
        const response = await POST(request());
        expect(await response.text()).not.toContain("fixture-provider-secret");
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
            "fixture-provider-secret",
        );
    });
});

describe("/api/ai/test guarded transport failure boundary", () => {
    it("does not hide SSRF denial as a capability error or attempt a fallback", async () => {
        const { AIUrlError } = await import("@/lib/ai-url");
        mocks.fetch.mockRejectedValue(new AIUrlError());
        const response = await POST(request());
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid AI endpoint" });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
    it("never reflects raw provider content on successful connections", async () => {
        mocks.fetch.mockResolvedValue(
            Response.json({
                choices: [{ message: { content: "fixture-provider-secret" } }],
            }),
        );
        const response = await POST(request());
        expect(await response.text()).not.toContain("fixture-provider-secret");
    });
    it("does not retry quota failures", async () => {
        mocks.fetch.mockResolvedValue(
            new Response("fixture-provider-secret", { status: 429 }),
        );
        const response = await POST(request());
        expect(await response.json()).toMatchObject({
            success: false,
            textError: "AI_QUOTA_EXCEEDED",
        });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
});
