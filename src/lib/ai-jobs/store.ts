import { validateIllustrationInput } from "../ai-drawing/illustration-service";
import { jobExpiry, readableJobWhere } from "../solving-records/retention";
import { diagnosticMessage } from "../ai/diagnostics";
import type { AiJob } from "@prisma/client";
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
) {
    const input = JobInputSchema.parse(raw);
    if(kind==="illustration_describe"){
        if((await requireLiveAiUser(userId)).role!=="admin")throw Error("AI_ACCESS_REVOKED");
        const {validateDescriptionInput}=await import("../ai-drawing/illustration-description");await validateDescriptionInput(input);
    }
    if(kind!=="illustration")await assertAiInputAllowed(userId,input);
    const payload = protect(input);
    return prisma.$transaction(async (tx) => {
        await requireTxAiUser(tx,userId,kind==="illustration"||kind==="illustration_describe");
        const prior = await tx.aiJob.findUnique({
            where: { userId_requestKey: { userId, requestKey } },
        });
        if (prior) {
            if (
                prior.kind !== kind ||
                JSON.stringify(unprotect(prior.input)) !== JSON.stringify(input)
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
    return {
        ...publicJob(j),
        attemptsLog: attempts.map(({metadata,...a})=>{const m=metadata?unprotect<import("../ai-dialogue/types").StepMetadata>(metadata):undefined;return {...a,...(m?{stage:m.stage,modelName:m.modelName,providerName:m.providerName,withImage:m.withImage,...(diagnosticMessage(m.diagnostic)?{diagnostic:m.diagnostic}:{})}: {})};}),
        ...(j.state === "success" && j.result
            ? { result: unprotect(j.result) }
            : {}),
        ...(restore ? { input: unprotect<JobInput>(j.input) } : {}),
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
