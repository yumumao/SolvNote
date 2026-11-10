import { validateIllustrationInput } from "../ai-drawing/illustration-service";
import { jobExpiry, readableJobWhere } from "../solving-records/retention";
import { diagnosticMessage } from "../ai/diagnostics";
import type { AiJob } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { assertAiInputAllowed, assertModelsAllowedForUser } from "../ai-access/effective-config";
import { requireTxAiUser, requireLiveAiUser } from "../ai-access/account";
import { protect, unprotect } from "../ai-config/vault";
import { JobInputSchema, type JobKind, type JobInput } from "./schema";
export function failureState(code: string, cancelled: boolean) {
    return cancelled
        ? "cancelled"
        : code === "AI_ACCEPTANCE_UNKNOWN"
          ? "unknown"
          : "failed";
}
export function publicJob(j: Pick<AiJob, "id" | "kind" | "state" | "attempts" | "errorCode" | "createdAt" | "updatedAt">) {
    return {
        id: j.id,
        kind: j.kind,
        state: j.state,
        attempts: j.attempts,
        errorCode: j.errorCode,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
    };
}
export async function submitJob(
    userId: string,
    kind: JobKind,
    raw: unknown,
    requestKey: string,
    submitted?: JobInput | Record<string, unknown>,
) {
    const input = JobInputSchema.parse(raw);
    // Server-only receipt: untrusted extra body fields are stripped before hashing.
    // Keep it encrypted with the job, without changing the persisted prompt fields.
    const receipt = submitted === undefined ? undefined : JobInputSchema.parse(submitted);
    const submissionHash = receipt === undefined ? undefined
        : createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
    if(kind==="illustration_describe"){
        if((await requireLiveAiUser(userId)).role!=="admin")throw Error("AI_ACCESS_REVOKED");
        const {validateDescriptionInput}=await import("../ai-drawing/illustration-description");await validateDescriptionInput(input);
    }
    if(kind!=="illustration")await assertAiInputAllowed(userId,input);
    const payload = protect(submissionHash ? { ...input, _submissionHash: submissionHash } : input);
    return prisma.$transaction(async (tx) => {
        await requireTxAiUser(tx,userId,kind==="illustration"||kind==="illustration_describe");
        const prior = await tx.aiJob.findUnique({
            where: { userId_requestKey: { userId, requestKey } },
        });
        if (prior) {
            const stored = unprotect<JobInput & { _submissionHash?: string }>(prior.input);
            const matches = typeof stored._submissionHash === "string" && /^[a-f0-9]{64}$/.test(stored._submissionHash)
                ? stored._submissionHash === submissionHash
                : [input, receipt].some(candidate => candidate !== undefined &&
                    JSON.stringify(JobInputSchema.parse(stored)) === JSON.stringify(candidate));
            if (
                prior.kind !== kind ||
                !matches
            )
                throw Error("REQUEST_CONFLICT");
            return prior;
        }
        if(kind==="illustration")await validateIllustrationInput(input,userId,tx);
        const count = await tx.aiJob.count({
            where: { userId, state: { in: ["pending", "running"] } },
        });
        if (count >= 5) throw Error("AI_QUEUE_FULL");
        if (
            (await tx.aiJob.count({
                where: { state: { in: ["pending", "running"] } },
            })) >= 30
        )
            throw Error("AI_QUEUE_FULL");
        return tx.aiJob.create({
            data: {
                userId,
                kind,
                requestKey,
                input: payload,
                expiresAt: jobExpiry(kind),
            },
        });
    });
}
export async function readJob(userId: string, id: string, restore = false) {
    await requireLiveAiUser(userId);
    const j = await prisma.aiJob.findFirst({
        where: { id, userId, conversationId: null, ...readableJobWhere() },
    });
    if (!j) return null;
    const attempts = await prisma.aiAttempt.findMany({
        where: { jobId: id },
        select: {
            metadata: true,
            modelId: true,
            state: true,
            errorCode: true,
            startedAt: true,
            finishedAt: true,
        },
        orderBy: { startedAt: "asc" },
    });
    if(j.kind==="illustration_describe")await prisma.$transaction(tx=>requireTxAiUser(tx,userId,true));
    if(j.kind==="illustration")await prisma.$transaction(tx=>requireTxAiUser(tx,userId,true));
    else await assertModelsAllowedForUser(userId,attempts.map(a=>a.modelId));
    const restored = restore ? unprotect<JobInput & { _submissionHash?: string }>(j.input) : undefined;
    // Historical job inputs may predate today's required fields; remove private
    // receipt metadata without revalidating/mutating their saved user-facing shape.
    if(restored)delete restored._submissionHash;
    return {
        ...publicJob(j),
        attemptsLog: attempts.map(({metadata,...a})=>{const m=metadata?unprotect<import("../ai-dialogue/types").StepMetadata>(metadata):undefined;return {...a,...(m?{stage:m.stage,modelName:m.modelName,providerName:m.providerName,withImage:m.withImage,...(m.timeoutFallback===true?{timeoutFallback:true as const}:{}),...(diagnosticMessage(m.diagnostic)?{diagnostic:m.diagnostic}:{})}: {})};}),
        ...(j.state === "success" && j.result
            ? { result: unprotect(j.result) }
            : {}),
        ...(restore ? { input: restored } : {}),
    };
}
export async function cancelJob(userId: string, id: string) {
    await requireLiveAiUser(userId);
    await prisma.aiJob.updateMany({
        where: { id, userId, conversationId: null, state: "pending" },
        data: { state: "cancelled", cancelRequested: true },
    });
    await prisma.aiJob.updateMany({
        where: { id, userId, conversationId: null, state: "running" },
        data: { cancelRequested: true },
    });
    return readJob(userId, id);
}
