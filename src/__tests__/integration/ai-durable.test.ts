// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient, type Prisma } from "@prisma/client";
const shared = vi.hoisted(() => ({
    db: null as unknown as PrismaClient,
    send: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
    get prisma() {
        return shared.db;
    },
}));
vi.mock("@/lib/config", () => ({
    getAppConfig: () => ({
        prompts: { similar: "CUSTOM_PRACTICE_MARKER {original_question}" },
        aiProvider: "openai",
        openai: {
            instances: [
                {
                    id: "test",
                    name: "test",
                    baseUrl: "https://example.com/v1",
                    apiKey: "synthetic-only",
                    model: "model",
                },
            ],
        },
    }),
}));
vi.mock("@/lib/ai/transport", async (original) => ({
    ...(await original<typeof import("@/lib/ai/transport")>()),
    sendAI: shared.send,
}));
import { submitJob, readJob, cancelJob } from "@/lib/ai-jobs/store";
import { claimJob, processOne } from "@/lib/ai-jobs/worker";
import { loadAIConfig, saveAIConfig } from "@/lib/ai-config/store";
import { unprotect } from "@/lib/ai-config/vault";
import { AIError } from "@/lib/ai/transport";
const answer =
    "<question_text>synthetic question</question_text><answer_text>42</answer_text><analysis>synthetic reasoning</analysis><subject>数学</subject><knowledge_points>test</knowledge_points>";
let oldDir: string | undefined;
beforeAll(async () => {
    mkdirSync(".codex/tmp", { recursive: true });
    const dir = mkdtempSync(path.resolve(".codex/tmp/durable-"));
    oldDir = process.env.AI_CONFIG_DIR;
    process.env.AI_CONFIG_DIR = path.join(dir, "config");
    const url = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`;
    execFileSync(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy"],
        { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
    );
    shared.db = new PrismaClient({ datasources: { db: { url } } });
    await shared.db.user.create({
        data: {
            id: "alice",
            email: "alice@example.invalid",
            password: "unused",
        },
    });
}, 30000);
afterAll(async () => {
    await shared.db.$disconnect();
    if (oldDir === undefined) delete process.env.AI_CONFIG_DIR;
    else process.env.AI_CONFIG_DIR = oldDir;
});
describe.sequential("durable SQLite integration", () => {
    it("migrates legacy once and encrypts config; rejects lost updates", async () => {
        const first = await loadAIConfig();
        const row = await shared.db.aiConfiguration.findUniqueOrThrow({
            where: { id: "site" },
        });
        expect(row.payload).not.toContain("synthetic-only");
        expect(unprotect(row.payload)).toEqual(first.config);
        await saveAIConfig(first.config, first.revision);
        await expect(
            saveAIConfig(first.config, first.revision),
        ).rejects.toThrow("CONFIG_CONFLICT");
    });
    it("deduplicates submission per owner and never returns another user task", async () => {
        const a = await submitJob(
            "alice",
            "analyze",
            { questionText: "synthetic" },
            "request-0001",
        );
        const b = await submitJob(
            "alice",
            "analyze",
            { questionText: "synthetic" },
            "request-0001",
        );
        expect(a.id).toBe(b.id);
        expect(await readJob("bob", a.id, true)).toBeNull();
        await expect(
            submitJob(
                "alice",
                "analyze",
                { questionText: "other" },
                "request-0001",
            ),
        ).rejects.toThrow("REQUEST_CONFLICT");
        expect((await cancelJob("alice", a.id))?.state).toBe("cancelled");
    });
    it("claims globally once and marks interrupted requests unknown on recovery", async () => {
        const a = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "request-0002",
        );
        expect((await claimJob("worker-a"))?.id).toBe(a.id);
        expect(await claimJob("worker-b")).toBeNull();
        await shared.db.aiWorkerLease.update({
            where: { id: "site" },
            data: { until: new Date(0) },
        });
        await shared.db.aiJob.update({
            where: { id: a.id },
            data: { leaseUntil: new Date(0) },
        });
        await claimJob("worker-b");
        expect((await readJob("alice", a.id))?.state).toBe("unknown");
    });
    it("persists completed result and does not automatically resubmit unknown calls", async () => {
        shared.send.mockReset().mockResolvedValue(answer);
        const j = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "request-0003",
        );
        await processOne("worker");
        expect((await readJob("alice", j.id))?.state).toBe("success");
        expect((await readJob("alice", j.id))?.result).toMatchObject({
            answerText: "42",
        });
        shared.send.mockRejectedValue(new AIError("AI_ACCEPTANCE_UNKNOWN"));
        const unknown = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "request-0004",
        );
        await processOne("worker");
        expect((await readJob("alice", unknown.id))?.state).toBe("unknown");
        await processOne("worker");
        expect(shared.send).toHaveBeenCalledTimes(2);
    });
    it("enforces per-user pending cap", async () => {
        for (let i = 0; i < 5; i++)
            await submitJob(
                "limit",
                "analyze",
                { questionText: "q" },
                `limit-${i}`,
            );
        await expect(
            submitJob("limit", "analyze", { questionText: "q" }, "limit-more"),
        ).rejects.toThrow("AI_QUEUE_FULL");
        await shared.db.aiJob.updateMany({
            where: { userId: "limit" },
            data: { state: "cancelled" },
        });
    });
});

describe.sequential("worker safety and image stages", () => {
    it("never replaces a missing encryption key during read", async () => {
        const file = path.join(process.env.AI_CONFIG_DIR!, "ai-master.key");
        renameSync(file, file + ".saved");
        try {
            await expect(loadAIConfig()).rejects.toThrow(
                "AI_MASTER_KEY_MISSING",
            );
            expect(existsSync(file)).toBe(false);
        } finally {
            if (existsSync(file)) renameSync(file, file + ".unexpected");
            renameSync(file + ".saved", file);
        }
    });
    it("does not execute a deactivated owner task", async () => {
        const user = await shared.db.user.create({
            data: {
                id: "disabled",
                email: "disabled@example.invalid",
                password: "unused",
                isActive: false,
            },
        });
        shared.send.mockReset().mockResolvedValue(answer);
        const j = await submitJob(
            user.id,
            "analyze",
            { questionText: "q" },
            "disabled-01",
        );
        await processOne("worker");
        expect((await readJob(user.id, j.id))?.state).toBe("cancelled");
        expect(shared.send).not.toHaveBeenCalled();
    });
    it("retains images through transcription, solving, and second-model review", async () => {
        const c = await loadAIConfig();
        const first = c.config.models[0];
        c.config.models.push({ ...first, id: "second" });
        c.config.chains.vision.push("second");
        await saveAIConfig(c.config, c.revision);
        const image = "data:image/png;base64,YQ==";
        shared.send
            .mockReset()
            .mockResolvedValueOnce("synthetic transcription")
            .mockResolvedValue(answer);
        const j = await submitJob(
            "alice",
            "analyze",
            {
                questionText: "q",
                imageBase64: image,
                mode: "transcribe",
                review: true,
            },
            "stages-001",
        );
        await processOne("worker");
        expect((await readJob("alice", j.id))?.state).toBe("success");
        expect(shared.send).toHaveBeenCalledTimes(3);
        for (const call of shared.send.mock.calls) expect(call[4]).toBe(image);
        expect(shared.send.mock.calls[2][1].id).not.toBe(
            shared.send.mock.calls[1][1].id,
        );
    });
    it("falls back once after explicit failure but does not resend ambiguous acceptance", async () => {
        const c = await loadAIConfig();
        c.config.chains.text = c.config.models.map((m) => m.id);
        await saveAIConfig(c.config, c.revision);
        shared.send
            .mockReset()
            .mockRejectedValueOnce(new AIError("AI_HTTP_503", true))
            .mockResolvedValue(answer);
        const j = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "fallback-01",
        );
        await processOne("worker");
        expect((await readJob("alice", j.id))?.state).toBe("success");
        expect(shared.send).toHaveBeenCalledTimes(2);
    });
});

describe.sequential("chain budgets and cancellation", () => {
    it("keeps the configuration snapshot between stages", async () => {
        const original = await loadAIConfig();
        const model = original.config.models[0];
        shared.send
            .mockReset()
            .mockImplementationOnce(async () => {
                const next = await loadAIConfig();
                next.config.models[0].model = "changed-mid-job";
                await saveAIConfig(next.config, next.revision);
                return "synthetic transcription";
            })
            .mockResolvedValue(answer);
        const job = await submitJob(
            "alice",
            "analyze",
            {
                questionText: "q",
                imageBase64: "data:image/png;base64,YQ==",
                mode: "transcribe",
            },
            "snapshot-01",
        );
        await processOne("worker");
        expect((await readJob("alice", job.id))?.state).toBe("success");
        expect(shared.send.mock.calls[1][1].model).toBe(model.model);
        const next = await loadAIConfig();
        await saveAIConfig(original.config, next.revision);
    });
    it("persists rate-limit cooldown and skips models sharing that allowance", async () => {
        const current = await loadAIConfig();
        const p = current.config.providers[0],
            m = current.config.models[0];
        current.config.providers.push({
            ...p,
            id: "independent",
            apiKey: "different-synthetic-key",
        });
        current.config.models.push({
            ...m,
            id: "independent-model",
            providerId: "independent",
        });
        current.config.chains.text = current.config.models.map((x) => x.id);
        await saveAIConfig(current.config, current.revision);
        shared.send
            .mockReset()
            .mockRejectedValueOnce(new AIError("AI_RATE_LIMIT", true, 60000))
            .mockResolvedValue(answer);
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "cooldown-01",
        );
        await processOne("worker");
        expect((await readJob("alice", job.id))?.state).toBe("success");
        expect(shared.send).toHaveBeenCalledTimes(2);
        expect(shared.send.mock.calls[1][0].id).toBe("independent");
        expect(await shared.db.aiCooldown.count()).toBe(1);
        await shared.db.aiCooldown.deleteMany();
    });
    it("does not persist a result when cancellation wins completion", async () => {
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "cancel-run-01",
        );
        shared.send.mockReset().mockImplementationOnce(async () => {
            await cancelJob("alice", job.id);
            return answer;
        });
        await processOne("worker");
        const saved = await readJob("alice", job.id);
        expect(saved?.state).toBe("cancelled");
        expect(saved).not.toHaveProperty("result");
        expect(shared.send).toHaveBeenCalledTimes(1);
    });
    it("enforces the same three-attempt ceiling on fallback", async () => {
        const current = await loadAIConfig();
        const m = current.config.models[0];
        current.config.models.push({ ...m, id: "fourth" });
        current.config.chains.text = current.config.models.map((x) => x.id);
        await saveAIConfig(current.config, current.revision);
        shared.send
            .mockReset()
            .mockRejectedValue(new AIError("AI_HTTP_503", true));
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "budget-01",
        );
        await processOne("worker");
        expect(shared.send).toHaveBeenCalledTimes(3);
        expect((await readJob("alice", job.id))?.errorCode).toBe(
            "AI_BUDGET_EXHAUSTED",
        );
    });
});

describe.sequential("dispatch fencing and review preservation", () => {
    it("does not call another model after success audit persistence fails", async () => {
        shared.send.mockReset().mockResolvedValue(answer);
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "audit-failure-01",
        );
        const originalDb = shared.db;
        let failed = false;
        shared.db = originalDb.$extends({
            query: {
                aiAttempt: {
                    $allOperations: async ({ args, query }) => {
                        if (
                            !failed &&
                            "data" in args &&
                            args.data &&
                            "state" in args.data &&
                            args.data.state === "success"
                        ) {
                            failed = true;
                            throw new Error("synthetic persistence failure");
                        }
                        return query(args);
                    },
                },
            },
        }) as unknown as PrismaClient;
        try {
            await processOne("worker");
            expect(failed).toBe(true);
            expect(shared.send).toHaveBeenCalledTimes(1);
            expect((await readJob("alice", job.id))?.state).not.toBe("success");
        } finally {
            shared.db = originalDb;
        }
    });
    it("stops further stages once cancellation has returned", async () => {
        const job = await submitJob(
            "alice",
            "analyze",
            {
                questionText: "q",
                imageBase64: "data:image/png;base64,YQ==",
                mode: "transcribe",
                review: true,
            },
            "dispatch-cancel-01",
        );
        shared.send
            .mockReset()
            .mockImplementationOnce(async () => {
                await cancelJob("alice", job.id);
                return "synthetic transcription";
            })
            .mockResolvedValue(answer);
        await processOne("worker");
        const saved = await readJob("alice", job.id);
        expect(saved?.state).toBe("cancelled");
        expect(shared.send).toHaveBeenCalledTimes(1);
        expect(saved?.attemptsLog.some((a) => a.state === "running")).toBe(
            false,
        );
    });
    it("never sends or overwrites attempt state after lease takeover", async () => {
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "dispatch-lease-01",
        );
        shared.send
            .mockReset()
            .mockImplementationOnce(async () => {
                await shared.db.aiWorkerLease.update({
                    where: { id: "site" },
                    data: { until: new Date(0) },
                });
                await shared.db.aiJob.update({
                    where: { id: job.id },
                    data: { leaseUntil: new Date(0) },
                });
                await claimJob("worker-b");
                throw new AIError("AI_HTTP_503", true);
            })
            .mockResolvedValue(answer);
        await processOne("worker");
        const saved = await readJob("alice", job.id);
        expect(saved?.state).toBe("unknown");
        expect(shared.send).toHaveBeenCalledTimes(1);
        expect(saved?.attemptsLog.map((a) => a.state)).toEqual(["unknown"]);
    });
    it("preserves mistake fields when review omits them, while allowing explicit clearing", async () => {
        const original =
            answer +
            "<wrong_answer_text>synthetic wrong answer</wrong_answer_text><mistake_analysis>synthetic error</mistake_analysis><mistake_status>wrong_attempt</mistake_status>";
        shared.send
            .mockReset()
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(answer);
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q", review: true },
            "review-fields-01",
        );
        await processOne("worker");
        expect((await readJob("alice", job.id))?.result).toMatchObject({
            wrongAnswerText: "synthetic wrong answer",
            mistakeAnalysis: "synthetic error",
            mistakeStatus: "wrong_attempt",
        });
        shared.send
            .mockReset()
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(
                answer +
                    "<wrong_answer_text></wrong_answer_text><mistake_analysis></mistake_analysis><mistake_status>not_attempted</mistake_status>",
            );
        const cleared = await submitJob(
            "alice",
            "analyze",
            { questionText: "q", review: true },
            "review-fields-02",
        );
        await processOne("worker");
        expect((await readJob("alice", cleared.id))?.result).toMatchObject({
            wrongAnswerText: "",
            mistakeAnalysis: "",
            mistakeStatus: "not_attempted",
        });
    });
});

describe.sequential("practice prompt compatibility", () => {
    it("retains the configured practice template", async () => {
        shared.send.mockReset().mockResolvedValue(answer);
        const job = await submitJob(
            "alice",
            "practice",
            { questionText: "synthetic practice", subject: "数学" },
            "practice-template-01",
        );
        await processOne("worker");
        expect((await readJob("alice", job.id))?.state).toBe("success");
        expect(shared.send.mock.calls[0][2]).toContain(
            "CUSTOM_PRACTICE_MARKER",
        );
    });
    it("retains the original subject after review", async () => {
        shared.send
            .mockReset()
            .mockResolvedValueOnce(answer)
            .mockResolvedValueOnce(
                answer.replace(
                    "<subject>数学</subject>",
                    "<subject>物理</subject>",
                ),
            );
        const job = await submitJob(
            "alice",
            "practice",
            {
                questionText: "synthetic practice",
                subject: "数学",
                review: true,
            },
            "practice-subject-01",
        );
        await processOne("worker");
        expect((await readJob("alice", job.id))?.result).toMatchObject({
            subject: "数学",
        });
    });
});

describe.sequential("final persistence and cancellation fences", () => {
    it("classifies a lost final result after upstream success as unknown", async () => {
        shared.send.mockReset().mockResolvedValue(answer);
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "final-persist-01",
        );
        const originalDb = shared.db;
        let failed = false;
        shared.db = originalDb.$extends({
            query: {
                aiJob: {
                    $allOperations: async ({ args, query }) => {
                        if (
                            !failed &&
                            "data" in args &&
                            args.data &&
                            "state" in args.data &&
                            args.data.state === "success"
                        ) {
                            failed = true;
                            throw new Error(
                                "synthetic result persistence failure",
                            );
                        }
                        return query(args);
                    },
                },
            },
        }) as unknown as PrismaClient;
        try {
            await processOne("worker");
            const saved = await readJob("alice", job.id);
            expect(failed).toBe(true);
            expect(shared.send).toHaveBeenCalledTimes(1);
            expect(saved?.state).toBe("unknown");
            expect(saved?.errorCode).toBe("AI_ACCEPTANCE_UNKNOWN");
            expect(saved?.attemptsLog.map((a) => a.state)).toEqual(["success"]);
        } finally {
            shared.db = originalDb;
        }
    });
    it("uses cancellation committed before the terminal transaction", async () => {
        const job = await submitJob(
            "alice",
            "analyze",
            { questionText: "q" },
            "terminal-cancel-01",
        );
        const originalDb = shared.db;
        let cancelAtNextTransaction = false;
        let cancelled = false;
        shared.db = new Proxy(originalDb, {
            get(target, prop) {
                if (prop === "$transaction")
                    return async (
                        callback: (
                            tx: Prisma.TransactionClient,
                        ) => Promise<unknown>,
                    ) => {
                        if (cancelAtNextTransaction) {
                            cancelAtNextTransaction = false;
                            await cancelJob("alice", job.id);
                            cancelled = true;
                        }
                        return target.$transaction(callback);
                    };
                const value = Reflect.get(target, prop, target);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        shared.send.mockReset().mockImplementationOnce(async () => {
            cancelAtNextTransaction = true;
            throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        });
        try {
            await processOne("worker");
            expect(cancelled).toBe(true);
            expect(shared.send).toHaveBeenCalledTimes(1);
            expect((await readJob("alice", job.id))?.state).toBe("cancelled");
        } finally {
            shared.db = originalDb;
        }
    });
});
