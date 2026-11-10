// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { PortableConfig } from "@/lib/ai-config/schema";
const fixture = vi.hoisted(() => ({ send: vi.fn(), config: null as unknown as PortableConfig, cooldown: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiCooldown: { findUnique: fixture.cooldown, upsert: vi.fn() } } }));
vi.mock("@/lib/ai-access/runtime", () => ({ runtimeConfig: async () => fixture.config, assertRunContributors: vi.fn() }));
vi.mock("@/lib/ai/transport", async original => ({ ...await original<typeof import("@/lib/ai/transport")>(), sendAI: fixture.send }));
import { callChain, type ChainOptions } from "@/lib/ai/chain";
import { AIError } from "@/lib/ai/transport";
import { aiRun, ATTEMPT_MS, TOTAL_MS, type AIRun } from "@/lib/ai-jobs/context";
import type { AIDiagnostic } from "@/lib/ai/diagnostics";
const image = "data:image/png;base64,YQ==";
let controller: AbortController, run: AIRun;
const timeout = (diagnostic: AIDiagnostic = "TIMEOUT_BEFORE_HEADERS") => new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, diagnostic);
const call = (options: ChainOptions = { role: "recognize", stage: "recognize", detailImages: [image] }) =>
    aiRun.run(run, () => callChain("synthetic instructions", "same question", image, JSON.parse, options));
beforeEach(() => {
    fixture.config = { version: 1, providers: [{ id: "p", name: "Fixture", protocol: "chat", baseUrl: "https://example.com/v1", apiKey: "synthetic-only", enabled: true }],
        models: ["first", "second", "third"].map(id => ({ id, providerId: "p", name: id, model: id, enabled: true, capabilities: ["text", "vision"] })),
        chains: { text: ["first", "second", "third"], vision: ["first", "second", "third"] } };
    fixture.send.mockReset().mockResolvedValue('{"complete":true}');
    fixture.cooldown.mockReset().mockResolvedValue(null);
    controller = new AbortController();
    run = { signal: controller.signal, deadline: Date.now() + TOTAL_MS, attempts: 0, maxAttempts: 3 };
});
afterEach(() => vi.restoreAllMocks());
it.each(["TIMEOUT_BEFORE_HEADERS", "TIMEOUT_READING_BODY"] as const)("switches after %s with identical source input and a fresh attempt signal", async diagnostic => {
    fixture.send.mockRejectedValueOnce(timeout(diagnostic));
    await expect(call()).resolves.toEqual({ complete: true });
    expect(fixture.send.mock.calls.map(c => c[1].id)).toEqual(["first", "second"]);
    const [first, second] = fixture.send.mock.calls;
    expect(second.slice(2, 5)).toEqual(first.slice(2, 5));
    expect(second.slice(6)).toEqual(first.slice(6));
    expect(second[7]).toBe("transcription");
    expect(second[5]).not.toBe(first[5]);
    expect(run.attempts).toBe(2);
});
it("applies the same bounded fallback to solving", async () => {
    fixture.send.mockRejectedValueOnce(timeout());
    await expect(call({ role: "solve", stage: "solve" })).resolves.toEqual({ complete: true });
    expect(fixture.send).toHaveBeenCalledTimes(2);
});
it.each([undefined, "NETWORK_BEFORE_HEADERS", "NETWORK_READING_BODY", "CANCELLED_BEFORE_HEADERS", "CANCELLED_READING_BODY", "STREAM_INCOMPLETE", "STREAM_INVALID"] as const)("does not broaden unknown %s into a retry", async diagnostic => {
    fixture.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN", false, 0, diagnostic));
    await expect(call()).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN" });
    expect(fixture.send).toHaveBeenCalledTimes(1);
});
it.each([{ singleAttempt: true }, { modelId: "first" }])("respects explicit single-model constraints %j", async options => {
    fixture.send.mockRejectedValueOnce(timeout());
    await expect(call(options)).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN" });
    expect(fixture.send).toHaveBeenCalledTimes(1);
});
it("stops cancellation even if the provider reports a timeout", async () => {
    fixture.send.mockImplementationOnce(async () => { controller.abort(); throw timeout(); });
    await expect(call()).rejects.toMatchObject({ code: "AI_CANCELLED" });
    expect(fixture.send).toHaveBeenCalledTimes(1);
});
it.each(["attempts", "deadline"] as const)("respects the remaining %s budget", async budget => {
    if (budget === "attempts") run.maxAttempts = 1;
    fixture.send.mockImplementationOnce(async () => { if (budget === "deadline") run.deadline = Date.now() - 1; throw timeout(); });
    await expect(call()).rejects.toMatchObject({ code: "AI_BUDGET_EXHAUSTED" });
    expect(fixture.send).toHaveBeenCalledTimes(1);
});
it("does not loop back when every configured model times out", async () => {
    fixture.send.mockRejectedValue(timeout());
    await expect(call()).rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN" });
    expect(fixture.send.mock.calls.map(c => c[1].id)).toEqual(["first", "second", "third"]);
});
it("skips a duplicate physical model registered under another connection alias", async () => {
    fixture.config.providers.push({ ...fixture.config.providers[0], id: "copy", baseUrl: "https://example.com/v1/chat/completions/" });
    fixture.config.models[1] = { ...fixture.config.models[0], id: "second", providerId: "copy" };
    fixture.send.mockRejectedValueOnce(timeout());
    await expect(call()).resolves.toEqual({ complete: true });
    expect(fixture.send.mock.calls.map(c => c[1].id)).toEqual(["first", "third"]);
});
it("keeps both the per-attempt time limit and total budget", async () => {
    const timer = vi.spyOn(AbortSignal, "timeout");
    fixture.send.mockRejectedValueOnce(timeout());
    await call();
    expect(ATTEMPT_MS).toBe(180000); expect(TOTAL_MS).toBe(600000);
    expect(timer.mock.calls).toEqual([[180000], [180000]]);
});
