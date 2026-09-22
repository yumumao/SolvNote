import { createHash } from "node:crypto";
import { loadAIConfig } from "../ai-config/store";
import { prisma } from "../prisma";
import { sendAI, AIError } from "./transport";
import { aiRun, ATTEMPT_MS, TOTAL_MS, type AIRun } from "../ai-jobs/context";

/** Register dispatch under the durable lease, not merely a delayed heartbeat. */
async function registerAttempt(run: AIRun, modelId: string) {
    if (!run.jobId) return null;
    if (!run.leaseOwner) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    return prisma.$transaction(async (tx) => {
        const now = new Date();
        const job = await tx.aiJob.findUnique({ where: { id: run.jobId } });
        if (job?.cancelRequested) throw new AIError("AI_CANCELLED");
        const account =
            job &&
            (await tx.user.findUnique({
                where: { id: job.userId },
                select: { isActive: true },
            }));
        if (job && !account?.isActive) throw new AIError("AI_USER_DISABLED");
        const lease = await tx.aiWorkerLease.findFirst({
            where: { id: "site", owner: run.leaseOwner, until: { gt: now } },
        });
        if (!lease) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        const claimed = await tx.aiJob.updateMany({
            where: {
                id: run.jobId,
                state: "running",
                cancelRequested: false,
                leaseOwner: run.leaseOwner,
                leaseUntil: { gt: now },
            },
            data: { attempts: run.attempts + 1 },
        });
        if (claimed.count !== 1) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        return tx.aiAttempt.create({
            data: { jobId: run.jobId!, modelId, state: "running" },
        });
    });
}

/** Never overwrite an attempt already reclaimed by another worker. */
async function finishAttempt(
    run: AIRun,
    id: string,
    state: string,
    errorCode?: string,
) {
    try {
        const changed = await prisma.aiAttempt.updateMany({
            where: {
                id,
                state: "running",
                job: {
                    state: "running",
                    leaseOwner: run.leaseOwner,
                    leaseUntil: { gt: new Date() },
                },
            },
            data: { state, errorCode, finishedAt: new Date() },
        });
        if (changed.count !== 1) throw new Error("LOST_DISPATCH_LEASE");
    } catch {
        // The upstream may have completed. A local audit failure is NEVER a retry signal.
        throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    }
}

export async function callChain<T>(
    prompt: string,
    text: string,
    image: string | undefined,
    parse: (s: string) => T,
): Promise<T> {
    const run =
        aiRun.getStore() ||
        ({
            signal: new AbortController().signal,
            deadline: Date.now() + TOTAL_MS,
            attempts: 0,
            maxAttempts: 3,
        } as AIRun);
    const config = run.config || (run.config = (await loadAIConfig()).config);
    const kind = image ? "vision" : "text";
    let last = new AIError(
        kind === "vision" ? "AI_NO_VISION_MODEL" : "AI_NO_TEXT_MODEL",
    );
    for (const id of config.chains[kind]) {
        if (id === run.excludeModel) continue;
        if (run.signal.aborted) throw new AIError("AI_CANCELLED");
        if (run.attempts >= run.maxAttempts || Date.now() >= run.deadline)
            throw new AIError("AI_BUDGET_EXHAUSTED");
        const model = config.models.find((m) => m.id === id);
        const provider = config.providers.find(
            (p) => p.id === model?.providerId,
        );
        if (
            !model?.enabled ||
            !provider?.enabled ||
            !model.capabilities.includes(kind)
        )
            continue;
        const group = createHash("sha256")
            .update(`${new URL(provider.baseUrl).host}:${provider.apiKey}`)
            .digest("hex");
        const cooldown = await prisma.aiCooldown.findUnique({
            where: { id: group },
        });
        if (cooldown && cooldown.until.getTime() > Date.now()) {
            last = new AIError("AI_RATE_LIMIT");
            continue;
        }
        const attempt = await registerAttempt(run, id);
        if (run.signal.aborted) throw new AIError("AI_CANCELLED");
        run.attempts++;
        const signal = AbortSignal.any([
            run.signal,
            AbortSignal.timeout(
                Math.max(1, Math.min(ATTEMPT_MS, run.deadline - Date.now())),
            ),
        ]);
        let value: T;
        try {
            // Only upstream/format failures may enter fallback. Local DB work stays outside.
            value = parse(
                await sendAI(provider, model, prompt, text, image, signal),
            );
        } catch (error) {
            const e =
                error instanceof AIError
                    ? error
                    : new AIError("AI_RESPONSE_ERROR", true);
            last = e;
            if (attempt)
                await finishAttempt(
                    run,
                    attempt.id,
                    e.code === "AI_ACCEPTANCE_UNKNOWN" ? "unknown" : "failed",
                    e.code,
                );
            if (e.retryAfterMs)
                await prisma.aiCooldown.upsert({
                    where: { id: group },
                    create: {
                        id: group,
                        until: new Date(Date.now() + e.retryAfterMs),
                    },
                    update: { until: new Date(Date.now() + e.retryAfterMs) },
                });
            if (!e.fallback) throw e;
            continue;
        }
        run.lastModel = id;
        if (attempt) await finishAttempt(run, attempt.id, "success");
        return value;
    }
    throw last;
}
