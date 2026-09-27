import { SOLVING_JOB_KINDS } from "../solving-records/retention";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { getAppConfig } from "../config";
import { protect, unprotect } from "../ai-config/vault";
import { ManagedAIService, dataImage } from "../ai/managed-service";
import { callChain } from "../ai/chain";
import { AIError } from "../ai/transport";
import { parseAnswer, parseQuestion } from "../ai/parse";
import { generateGradeInstruction } from "../ai/prompts";
import { aiRun, TOTAL_MS } from "./context";
import { type JobInput } from "./schema";
import { failureState } from "./store";
import { executeDialogueJob, recoverDialogue } from "../ai-dialogue/execution";
import { requireLiveAiUser } from "../ai-access/account";
import { loadEffectiveAIConfigInTx } from "../ai-access/effective-config";
import { assertJobModelAccess, assertConversationModelAccess } from "../ai-access/runtime";
const LEASE_MS = 60000;
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
export async function claimJob(owner: string) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
        await tx.aiWorkerLease.upsert({
            where: { id: "site" },
            create: { id: "site", owner: "", until: new Date(0) },
            update: {},
        });
        const lock = await tx.aiWorkerLease.updateMany({
            where: { id: "site", until: { lt: now } },
            data: { owner, until: new Date(Date.now() + LEASE_MS) },
        });
        if (!lock.count) return null;
        const stale = await tx.aiJob.findMany({where:{state:"running",leaseUntil:{lt:now},conversationId:{not:null}}});
        for (const old of stale) await recoverDialogue(tx, old, now);
        // A crashed worker may already have incurred upstream charges. Never resend automatically.
        await tx.aiJob.updateMany({
            where: { state: "running", leaseUntil: { lt: now } },
            data: {
                state: "unknown",
                errorCode: "AI_ACCEPTANCE_UNKNOWN",
                leaseOwner: null,
                leaseUntil: null,
            },
        });
        await tx.aiAttempt.updateMany({
            where: { state: "running", job: { state: "unknown" } },
            data: {
                state: "unknown",
                errorCode: "AI_ACCEPTANCE_UNKNOWN",
                finishedAt: now,
            },
        });
        // Preserve surviving pre-upgrade solves without silently resubmitting expired work.
        await tx.aiJob.updateMany({
            where: { conversationId: null, kind: { in: SOLVING_JOB_KINDS }, expiresAt: { lte: now }, state: "pending" },
            data: { state: "failed", errorCode: "AI_TASK_EXPIRED" },
        });
        await tx.aiJob.deleteMany({
            where: { conversationId: null, kind: { notIn: SOLVING_JOB_KINDS }, expiresAt: { lt: now }, state: { not: "running" } },
        });
        const job = await tx.aiJob.findFirst({
            where: {
                state: "pending",
                cancelRequested: false,
                expiresAt: { gt: now },
            },
            orderBy: { createdAt: "asc" },
        });
        if (!job) {
            await tx.aiWorkerLease.update({
                where: { id: "site" },
                data: { until: new Date(0) },
            });
            return null;
        }
        return tx.aiJob.update({
            where: { id: job.id },
            data: {
                state: "running",
                startedAt: new Date(),
                leaseOwner: owner,
                leaseUntil: new Date(Date.now() + LEASE_MS),
            },
        });
    });
}
async function execute(kind: string, input: JobInput) {
    if(kind === "construction" || kind === "image_edit"){
        const { executeDrawing } = await import("../ai-drawing/service");
        return executeDrawing(kind,input);
    }
    const service = new ManagedAIService();
    const image = dataImage(input.imageBase64, input.mimeType);
    let text = input.questionText;
    if (input.mode === "transcribe" && image) {
        const transcript = await callChain(
            "只转录图片中的题目、公式、已知条件与图形标注。不能凭空补充看不清的条件；保留不确定项。不要解题。",
            text,
            image,
            (s) => s,
        );
        text = `${text}\n图片转录（仅供参考，以原图为准）：\n${transcript}`;
    }
    let result;
    if (kind === "analyze")
        result = await service.analyzeInput(
            text,
            image,
            input.language,
            input.grade,
            input.subject,
            input.gradeSemester,
        );
    else if (kind === "reanswer")
        result = await service.reanswerQuestion(
            text,
            input.language,
            input.subject,
            image,
            input.gradeSemester,
        );
    else if (kind === "practice") {
        // Carry geometry from original through generation; do not turn figure-only conditions into invented prose.
        const { generateSimilarQuestionPrompt } = await import("../ai/prompts");
        result = await callChain(
            generateSimilarQuestionPrompt(
                input.language,
                text,
                input.tags,
                input.difficulty,
                { customTemplate: getAppConfig().prompts?.similar },
                input.gradeSemester,
            ),
            image
                ? "原题图一并提供。变式题若仍依赖此图必须标记requires_image。"
                : "生成变式题。",
            image,
            parseQuestion,
        );
        if (input.subject && result && "subject" in result)
            result = {
                ...result,
                subject: input.subject as typeof result.subject,
            };
    } else if(kind === "geogebra")
        result = await service.analyzeForGeogebra(
            text,
            input.answerText,
            input.analysis,
            input.previousErrors,
            image,
        );
    else throw new AIError("AI_UNKNOWN_JOB_KIND");
    if (input.review && kind !== "geogebra") {
        const run = aiRun.getStore();
        if (run) run.excludeModel = run.lastModel;
        const prompt = `请独立复核题目与候选解答，纠正错误，不要因为目标年级而给出错误解答。${generateGradeInstruction(input.gradeSemester)}\n按以下XML输出：${kind === "reanswer" ? "" : "<question_text>完整题干</question_text><subject>学科</subject><requires_image>true或false</requires_image>"}<answer_text>答案</answer_text><analysis>完整推导与新增概念解释</analysis><knowledge_points>逗号分隔知识点</knowledge_points><wrong_answer_text>用户原错答，没有则为空</wrong_answer_text><mistake_analysis>错因，没有则为空</mistake_analysis><mistake_status>wrong_attempt或not_attempted或unknown</mistake_status>\n候选解答仅供检验：${JSON.stringify(result)}`;
        try {
            const previous: Partial<ReturnType<typeof parseAnswer>> =
                "answerText" in result ? result : {};
            result = await callChain(prompt, text, image, (raw) => {
                const reviewed =
                    kind === "reanswer" ? parseAnswer(raw) : parseQuestion(raw);
                // Missing tags are not instructions to erase the user's original mistake.
                for (const [field, xml] of [
                    ["wrongAnswerText", "wrong_answer_text"],
                    ["mistakeAnalysis", "mistake_analysis"],
                    ["mistakeStatus", "mistake_status"],
                ] as const) {
                    if (
                        !new RegExp(`<${xml}\\s*>`, "i").test(raw) &&
                        field in previous
                    ) {
                        Object.assign(reviewed, { [field]: previous[field] });
                    }
                }
                return reviewed;
            });
        } finally {
            if (run) run.excludeModel = undefined;
        }
    }
    if (kind === "practice" && input.subject && "subject" in result) {
        result = { ...result, subject: input.subject as typeof result.subject };
    }
    return result;
}
export async function processOne(owner: string = randomUUID()) {
    const job = await claimJob(owner);
    if (!job) return false;
    const controller = new AbortController();
    let executionCompleted = false;
    const total = setTimeout(() => controller.abort(), job.kind === "dialogue" ? 1800000 : TOTAL_MS);
    const heartbeat = setInterval(() => {
        void (async () => {
            if (job.conversationId) await assertConversationModelAccess(job.userId,job.conversationId);
            else await assertJobModelAccess(job.userId,job.id);
            const now = new Date(Date.now() + LEASE_MS);
            const updated = await prisma.aiWorkerLease.updateMany({
                where: { id: "site", owner, until: { gt: new Date() } },
                data: { until: now },
            });
            if (!updated.count) {
                controller.abort();
                return;
            }
            const current = await prisma.aiJob.findUnique({
                where: { id: job.id },
            });
            if (current?.cancelRequested || current?.leaseOwner !== owner) {
                controller.abort();
                return;
            }
            await prisma.aiJob.updateMany({
                where: { id: job.id, leaseOwner: owner, state: "running" },
                data: { leaseUntil: now },
            });
        })().catch(() => controller.abort());
    }, 5000);
    try {
        try { await requireLiveAiUser(job.userId); } catch { throw new AIError("AI_ACCESS_REVOKED"); }
        if (job.kind === "dialogue") {
            await executeDialogueJob(job, owner, controller);
            return true;
        }
        const account = await requireLiveAiUser(job.userId);
        if (!account?.isActive) {
            await prisma.aiJob.updateMany({
                where: { id: job.id, leaseOwner: owner, state: "running" },
                data: { cancelRequested: true },
            });
            throw new AIError("AI_USER_DISABLED");
        }
        const input = unprotect<JobInput>(job.input);
        const result = await aiRun.run(
            {
                userId: job.userId,
                jobId: job.id,
                leaseOwner: owner,
                signal: controller.signal,
                deadline: Date.now() + TOTAL_MS,
                attempts: 0,
                maxAttempts: 3,
            },
            () => execute(job.kind, input),
        );
        executionCompleted = true;
        try { await assertJobModelAccess(job.userId,job.id); } catch { throw new AIError("AI_ACCESS_REVOKED"); }
        const current = await prisma.aiJob.findUnique({
            where: { id: job.id },
        });
        if (
            !controller.signal.aborted &&
            !current?.cancelRequested &&
            current?.leaseOwner === owner
        ) {
            await prisma.$transaction(async (tx) => {
                const effective = await loadEffectiveAIConfigInTx(tx,job.userId);
                const contributors = await tx.aiAttempt.findMany({where:{jobId:job.id},select:{modelId:true}});
                if(contributors.some(a=>!effective.config.models.some(m=>m.id===a.modelId))) throw new AIError("AI_ACCESS_REVOKED");
                const committed = await tx.aiJob.updateMany({
                    where: {
                        id: job.id,
                        leaseOwner: owner,
                        state: "running",
                        cancelRequested: false,
                        leaseUntil: { gt: new Date() },
                    },
                    data: {
                        state: "success",
                        result: protect(result),
                        leaseOwner: null,
                        leaseUntil: null,
                    },
                });
                if (committed.count !== 1)
                    throw new AIError("AI_ACCEPTANCE_UNKNOWN");
                if (job.kind === "geogebra" && input.errorItemId) {
                    const r = result as {
                        suitable: boolean;
                        commands: string[];
                    };
                    if (r.suitable && r.commands.length)
                        await tx.errorItem.updateMany({
                            where: {
                                id: input.errorItemId,
                                userId: job.userId,
                            },
                            data: {
                                geogebraCommands: JSON.stringify(r.commands),
                            },
                        });
                }
            });
        } else throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    } catch (e) {
        // Once upstream processing completed, local persistence failure cannot
        // be represented as an ordinary retryable execution failure.
        const code =
            e instanceof AIError
                ? e.code
                : executionCompleted
                  ? "AI_ACCEPTANCE_UNKNOWN"
                  : "AI_INTERNAL_ERROR";
        await prisma.$transaction(async (tx) => {
            const current = await tx.aiJob.findUnique({
                where: { id: job.id },
            });
            const state = failureState(
                code,
                !!current?.cancelRequested || code === "AI_USER_DISABLED" || code === "AI_ACCESS_REVOKED",
            );
            const changed = await tx.aiJob.updateMany({
                where: { id: job.id, state: "running", leaseOwner: owner },
                data: {
                    state,
                    errorCode: code,
                    leaseOwner: null,
                    leaseUntil: null,
                },
            });
            if (changed.count === 1 && job.conversationId)
                await tx.aiConversation.updateMany({where:{id:job.conversationId,activeJobId:job.id},data:{state,revision:{increment:1}}});
            if (changed.count === 1)
                await tx.aiAttempt.updateMany({
                    where: { jobId: job.id, state: "running" },
                    data: {
                        state: state === "cancelled" ? "cancelled" : "unknown",
                        errorCode: code,
                        finishedAt: new Date(),
                    },
                });
        });
    } finally {
        clearInterval(heartbeat);
        clearTimeout(total);
        await prisma.aiWorkerLease.updateMany({
            where: { id: "site", owner },
            data: { until: new Date(0) },
        });
    }
    return true;
}
const globals = globalThis as typeof globalThis & { aiWorkerStarted?: boolean };
export function startAIWorker() {
    if (globals.aiWorkerStarted || process.env.AI_WORKER_DISABLED === "1")
        return;
    globals.aiWorkerStarted = true;
    // A supervised process lifecycle loop, not request-scoped fire-and-forget work.
    void (async () => {
        while (globals.aiWorkerStarted) {
            try {
                if (await processOne()) continue;
            } catch {
                console.error(
                    "[ai-worker] cycle failed; will retry (details redacted)",
                );
            }
            await sleep(2000);
        }
    })();
}
