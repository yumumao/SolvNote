import type { StepMetadata } from "../ai-dialogue/types";
import { diagnosticMessage } from "./diagnostics";
import { protect } from "../ai-config/vault";
import type { AIModel, AIProvider } from "../ai-config/schema";
import { createHash } from "node:crypto";
import { loadAIConfig } from "../ai-config/store";
import { prisma } from "../prisma";
import { sendAI, AIError } from "./transport";
import { sendImageEdit } from "../ai-drawing/image-edit";
import { aiRun, ATTEMPT_MS, TOTAL_MS, type AIRun } from "../ai-jobs/context";

/** Register dispatch under the durable lease, not merely a delayed heartbeat. */
export type ChainOptions = {
    role?: "solve" | "recognize";
    stage?: "recognize" | "solve" | "reread" | "review" | "geometry_check" | "construction" | "image_edit";
    detailImages?: string[];
    imageEdit?: boolean;
    modelId?: string;
    question?: string[];
};
function attemptMetadata(run: AIRun, model: AIModel, provider: AIProvider, image: string | undefined, options: ChainOptions): StepMetadata {
    return {
        round: run.round, stage: options.stage || "solve", modelName: model.name, model: model.model,
        providerName: provider.name, withImage: !!image,
        questions: options.question || [], detailImageCount: image ? options.detailImages?.length || 0 : 0,
    };
}
async function registerAttempt(run: AIRun, model: AIModel, provider: AIProvider, image: string | undefined, options: ChainOptions) {
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
            data: { attempts: run.attempts - (run.startingAttempts || 0) + 1 },
        });
        if (claimed.count !== 1) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        if (run.conversationId) {
            const saved = await tx.aiConversation.updateMany({
                where: { id: run.conversationId, activeJobId: run.jobId, state: "active", roundAttempts: run.attempts },
                data: { roundAttempts: run.attempts + 1 },
            });
            if (saved.count !== 1) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        }
        return tx.aiAttempt.create({
            data: { jobId: run.jobId!, modelId: model.id, state: "running", metadata: protect(attemptMetadata(run, model, provider, image, options)) },
        });
    });
}

/** Never overwrite an attempt already reclaimed by another worker. */
async function finishAttempt(
    run: AIRun,
    id: string,
    state: string,
    errorCode?: string,
    metadata?: StepMetadata,
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
            data: { state, errorCode, finishedAt: new Date(), ...(metadata ? { metadata: protect(metadata) } : {}) },
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
    options: ChainOptions = {},
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
    const kind = options.role ? (options.role === "recognize" ? "vision" : "text") : image ? "vision" : "text";
    let last = new AIError(
        kind === "vision" ? "AI_NO_VISION_MODEL" : "AI_NO_TEXT_MODEL",
    );
    if(options.imageEdit && (!options.modelId || !image))throw new AIError("AI_IMAGE_EDIT_UNSUPPORTED");
    const ids=options.imageEdit ? [options.modelId!] : config.chains[kind].filter(id => !options.modelId || options.modelId === id);
    for (const id of ids) {
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
        if(options.imageEdit && provider.protocol!=="gemini")throw new AIError("AI_IMAGE_EDIT_UNSUPPORTED");
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
        const attachedImage = model.capabilities.includes("vision") ? image : undefined;
        const attempt = await registerAttempt(run, model, provider, attachedImage, options);
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
                options.imageEdit ? await sendImageEdit(provider,model,`${prompt}\n${text}`,attachedImage!,signal) : await sendAI(provider, model, prompt, text, attachedImage, signal, attachedImage ? options.detailImages : undefined, options.role === "recognize" ? "transcription" : undefined),
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
                    diagnosticMessage(e.diagnostic)
                        ? { ...attemptMetadata(run, model, provider, attachedImage, options), diagnostic: e.diagnostic }
                        : undefined,
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
            if (options.imageEdit || !e.fallback) throw e;
            continue;
        }
        run.lastModel = id;
        if (attempt) await finishAttempt(run, attempt.id, "success");
        return value;
    }
    throw last;
}
