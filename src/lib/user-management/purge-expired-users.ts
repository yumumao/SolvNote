import {Prisma} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import {ACCOUNT_RETENTION_DAYS, DAY_MS} from "./policy";
import {deleteUserRows} from "./users";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
type PurgeResult = {deleted: number};

const state = globalThis as typeof globalThis & {
    solvnotePurgeTimer?: ReturnType<typeof setInterval>;
    solvnotePurgeQueue?: Promise<unknown>;
    solvnotePurgeWorkerRunning?: boolean;
};

async function purgeBatch(now: Date): Promise<PurgeResult> {
    const cutoff = new Date(now.getTime() - ACCOUNT_RETENTION_DAYS * DAY_MS);
    return prisma.$transaction(async tx => {
        // Prefer an admin that is not due for deletion. If ALL admins are overdue,
        // retain one deterministic recovery account, even if it is disabled/expired.
        // This does not reactivate, renew or otherwise bypass the live auth guard.
        const retainedAdmin = await tx.user.findFirst({
            where: {role: "admin", OR: [{expiresAt: null}, {expiresAt: {gt: cutoff}}]},
            orderBy: [{isActive: "desc"}, {id: "asc"}],
            select: {id: true},
        }) ?? await tx.user.findFirst({
            where: {role: "admin"},
            orderBy: [{isActive: "desc"}, {expiresAt: "desc"}, {id: "asc"}],
            select: {id: true},
        });
        const users = await tx.user.findMany({
            where: {
                expiresAt: {lte: cutoff},
                // Exclude the recovery account BEFORE limiting the batch.
                ...(retainedAdmin ? {id: {not: retainedAdmin.id}} : {}),
            },
            orderBy: [{expiresAt: "asc"}, {id: "asc"}],
            select: {id: true, revision: true, role: true},
            take: BATCH_SIZE,
        });
        let deleted = 0;
        for (const user of users) {
            // Acquire a write claim using the current expiry/revision/role. A renewal
            // or role change must not be purged using a stale candidate snapshot.
            const claimed = await tx.user.updateMany({
                where: {id: user.id, revision: user.revision, role: user.role, expiresAt: {lte: cutoff}},
                data: {revision: {increment: 1}},
            });
            if (claimed.count !== 1) continue;

            // There is no managed attachment directory in this application:
            // image-utils -> data URL -> ErrorItem.originalImageUrl; AI image inputs
            // live in AiJob.input / AiConversation.payload / AiConversationAction.payload.
            // Import accepts arbitrary URL strings, NOT trusted filesystem paths.
            // deleteUserRows deletes detached jobs; User FKs cascade the inline data.
            // Never unlink/fetch these values, decrypt payloads, or touch config/vault files.
            // A future disk-backed uploader needs an explicit ownership + durable outbox
            // contract before any filesystem cleanup can safely be added here.
            await deleteUserRows(tx, user.id);
            await tx.userAuditEvent.create({data: {targetId: user.id, action: "expired-user-purged"}});
            deleted++;
        }
        await tx.authRateLimit.deleteMany({where: {windowEnd: {lte: now}}});
        return {deleted};
    }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000});
}

async function purgeWithRetry(now: Date): Promise<PurgeResult> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await purgeBatch(now);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
            // Retry the ENTIRE transaction, including administrator selection and
            // expiry checks. Other failures propagate; the next hourly run can retry.
            if (attempt >= MAX_ATTEMPTS || (code !== "P2034" && code !== "P1008")) throw error;
            await new Promise(resolve => setTimeout(resolve, 25 * attempt));
        }
    }
}

export async function purgeExpiredUsers(now = new Date()): Promise<PurgeResult> {
    // Snapshot the caller's Date before queueing. Keep local workers/callers from
    // overlapping; serializable transactions remain the cross-process safety gate.
    const timestamp = new Date(now.getTime());
    const run = (state.solvnotePurgeQueue ?? Promise.resolve()).then(() => purgeWithRetry(timestamp));
    state.solvnotePurgeQueue = run.catch(() => {});
    return run;
}

export function startUserRetentionWorker() {
    if (state.solvnotePurgeTimer) return;
    const run = () => {
        if (state.solvnotePurgeWorkerRunning) return;
        state.solvnotePurgeWorkerRunning = true;
        void purgeExpiredUsers()
            .catch(() => { /* Transaction rolled back; retry next tick, without row/secret logs. */ })
            .finally(() => { state.solvnotePurgeWorkerRunning = false; });
    };
    state.solvnotePurgeTimer = setInterval(run, 60 * 60 * 1000);
    state.solvnotePurgeTimer.unref();
    run();
}
