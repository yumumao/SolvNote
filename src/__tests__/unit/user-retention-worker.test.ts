// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    tx: {
        user: {findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn()},
        userAuditEvent: {create: vi.fn()},
        authRateLimit: {deleteMany: vi.fn()},
    },
    transaction: vi.fn(),
    deleteUserRows: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({prisma: {$transaction: mocks.transaction}}));
vi.mock("@/lib/user-management/users", () => ({deleteUserRows: mocks.deleteUserRows}));
import {purgeExpiredUsers, startUserRetentionWorker} from "@/lib/user-management/purge-expired-users";

const now = new Date("2026-09-27T00:00:00Z");
const cutoff = new Date(now.getTime() - 30 * 86_400_000);
const state = globalThis as typeof globalThis & {
    solvnotePurgeTimer?: ReturnType<typeof setInterval>;
    solvnotePurgeQueue?: Promise<unknown>;
    solvnotePurgeWorkerRunning?: boolean;
};
beforeEach(() => {
    vi.resetAllMocks();
    delete state.solvnotePurgeQueue;
    delete state.solvnotePurgeWorkerRunning;
    mocks.transaction.mockImplementation(async callback => callback(mocks.tx));
    mocks.tx.user.findFirst.mockResolvedValue({id: "keeper"});
    mocks.tx.user.findMany.mockResolvedValue([]);
    mocks.tx.user.updateMany.mockResolvedValue({count: 1});
});
afterEach(async () => {
    if (state.solvnotePurgeTimer) clearInterval(state.solvnotePurgeTimer);
    delete state.solvnotePurgeTimer;
    await state.solvnotePurgeQueue;
    vi.useRealTimers();
});

describe("retention transaction and timer contracts", () => {
    it("uses Serializable and bounded metadata-only selection; excludes recovery admin before take", async () => {
        await purgeExpiredUsers(now);
        expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
            isolationLevel: "Serializable", timeout: 10_000,
        });
        expect(mocks.tx.user.findMany).toHaveBeenCalledWith({
            where: {expiresAt: {lte: cutoff}, id: {not: "keeper"}},
            orderBy: [{expiresAt: "asc"}, {id: "asc"}],
            select: {id: true, revision: true, role: true}, take: 100,
        });
    });

    it("does not delete or audit if current expiry/role/revision fails the write claim", async () => {
        mocks.tx.user.findMany.mockResolvedValue([{id: "renewed", revision: 4, role: "user"}]);
        mocks.tx.user.updateMany.mockResolvedValue({count: 0});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
        expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
            where: {id: "renewed", revision: 4, role: "user", expiresAt: {lte: cutoff}},
            data: {revision: {increment: 1}},
        });
        expect(mocks.deleteUserRows).not.toHaveBeenCalled();
        expect(mocks.tx.userAuditEvent.create).not.toHaveBeenCalled();
    });

    it("uses the same transaction for claiming, deleting rows and auditing", async () => {
        mocks.tx.user.findMany.mockResolvedValue([{id: "due", revision: 1, role: "admin"}]);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(mocks.deleteUserRows).toHaveBeenCalledWith(mocks.tx, "due");
        expect(mocks.tx.userAuditEvent.create).toHaveBeenCalledWith({data: {targetId: "due", action: "expired-user-purged"}});
        expect(mocks.tx.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteUserRows.mock.invocationCallOrder[0]);
        expect(mocks.deleteUserRows.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.userAuditEvent.create.mock.invocationCallOrder[0]);
    });

    it("snapshots a caller-owned Date before the queued operation starts", async () => {
        const callerDate = new Date(now);
        const running = purgeExpiredUsers(callerDate);
        callerDate.setUTCFullYear(2099);
        await running;
        expect(mocks.tx.authRateLimit.deleteMany).toHaveBeenCalledWith({where: {windowEnd: {lte: now}}});
    });

    it("starts once, unrefs the timer and skips overlapping ticks", async () => {
        vi.useFakeTimers();
        let release!: (value: {deleted: number}) => void;
        mocks.transaction.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
        startUserRetentionWorker();
        const timer = state.solvnotePurgeTimer;
        startUserRetentionWorker();
        expect(state.solvnotePurgeTimer).toBe(timer);
        expect(timer?.hasRef()).toBe(false);
        await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        release({deleted: 0});
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(mocks.transaction).toHaveBeenCalledTimes(2);
    });

    it("clears the worker running flag after failure and retries on the next hourly tick", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error");
        mocks.transaction.mockRejectedValueOnce(new Error("synthetic-private-row-error"));
        startUserRetentionWorker();
        await vi.advanceTimersByTimeAsync(0);
        expect(state.solvnotePurgeWorkerRunning).toBe(false);
        expect(consoleError).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(mocks.transaction).toHaveBeenCalledTimes(2);
    });
});
