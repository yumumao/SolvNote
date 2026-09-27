// @vitest-environment node
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {PrismaClient, type Prisma} from "@prisma/client";
import {copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

const shared = vi.hoisted(() => ({db: null as unknown as PrismaClient, authorizeAiInput: vi.fn()}));
vi.mock("@/lib/prisma", () => ({get prisma() { return shared.db; }}));
vi.mock("@/lib/ai-access/registration", () => ({createInitialAiGrants: vi.fn()}));
// Exercise the REAL transaction account guard without auth/config/key/network access.
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("@/lib/ai-access/effective-config", () => ({
    assertAiInputAllowed: shared.authorizeAiInput,
    assertModelsAllowedForUser: vi.fn(),
}));
vi.mock("@/lib/ai-config/vault", () => ({
    protect: (value: unknown) => JSON.stringify(value),
    unprotect: (value: string) => JSON.parse(value),
}));
import {submitJob} from "@/lib/ai-jobs/store";
import {purgeExpiredUsers} from "@/lib/user-management/purge-expired-users";

const DAY = 86_400_000;
const now = new Date("2026-09-27T00:00:00.000Z");
const cutoff = new Date(now.getTime() - 30 * DAY);
let fixtureDir: string;
let fixtureUrl: string;

beforeAll(async () => {
    // Copy schema/migration CODE into an isolated cwd: never load a real .env or DB.
    mkdirSync(".codex/tmp", {recursive: true});
    fixtureDir = mkdtempSync(path.resolve(".codex/tmp/user-retention-"));
    const schemaDir = path.join(fixtureDir, "prisma");
    mkdirSync(schemaDir);
    copyFileSync("prisma/schema.prisma", path.join(schemaDir, "schema.prisma"));
    cpSync("prisma/migrations", path.join(schemaDir, "migrations"), {recursive: true});
    const url = "file:" + path.join(fixtureDir, "fixture.db").replaceAll("\\", "/");
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
        cwd: fixtureDir, env: {...process.env, DATABASE_URL: url}, windowsHide: true, stdio: "pipe",
    });
    fixtureUrl = url;
    shared.db = new PrismaClient({datasources: {db: {url}}});
    await shared.db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
}, 30_000);

beforeEach(async () => {
    shared.authorizeAiInput.mockReset().mockResolvedValue(undefined);
    await shared.db.aiJob.deleteMany();
    await shared.db.user.deleteMany();
    await shared.db.userAuditEvent.deleteMany();
    await shared.db.authRateLimit.deleteMany();
});
afterAll(async () => { await shared.db?.$disconnect(); });

const user = (id: string, data: Partial<Prisma.UserCreateInput> = {}) => shared.db.user.create({
    data: {id, email: `${id}@retention.invalid`, password: "synthetic-not-a-login", ...data},
});
const remaining = async () => (await shared.db.user.findMany({select: {id: true}, orderBy: {id: "asc"}})).map(u => u.id);
const job = (userId: string) => shared.db.aiJob.create({data: {
    userId, kind: "text", requestKey: "retention-fixture", input: "synthetic-inline-image", expiresAt: now,
}});


// A second REAL SQLite client holds the write lock before the purge starts.
// The purge must wait/re-read committed eligibility, not cache candidates outside its transaction.
async function raceCommittedWrite(write: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    const other = new PrismaClient({datasources: {db: {url: fixtureUrl}}});
    let running: Promise<{deleted: number}> | undefined;
    try {
        await other.$transaction(async tx => {
            await write(tx);
            running = purgeExpiredUsers(now);
            await new Promise(resolve => setTimeout(resolve, 25));
        });
        return await running;
    } finally { await other.$disconnect(); }
}
describe.sequential("30-day retention on disposable SQLite only", () => {
    it("includes the exact 30-day boundary, not one millisecond earlier; null/valid expiry is protected", async () => {
        await user("due", {expiresAt: cutoff});
        await user("older", {expiresAt: new Date(cutoff.getTime() - 1)});
        await user("almost", {expiresAt: new Date(cutoff.getTime() + 1)});
        await user("permanent");
        await user("future", {expiresAt: new Date(now.getTime() + DAY)});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 2});
        expect(await remaining()).toEqual(["almost", "future", "permanent"]);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
        expect(await shared.db.userAuditEvent.count({where: {action: "expired-user-purged"}})).toBe(2);
    });

    it("purges expired admins as well as users when an effective administrator survives", async () => {
        await user("effective-admin", {role: "admin"});
        await user("expired-admin", {role: "admin", expiresAt: cutoff});
        await user("disabled-expired-admin", {role: "admin", isActive: false, expiresAt: cutoff});
        await user("expired-user", {expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 3});
        expect(await remaining()).toEqual(["effective-admin"]);
    });

    it.each([true, false])("retains the final expired admin for recovery (isActive=%s), without renewing it", async isActive => {
        const admin = await user("last-admin", {role: "admin", isActive, expiresAt: cutoff});
        await user("due", {expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await shared.db.user.findUnique({where: {id: admin.id}})).toEqual(admin);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
    });

    it("keeps only one recoverable admin when all admins are beyond retention", async () => {
        await user("a-admin", {role: "admin", expiresAt: cutoff});
        await user("b-admin", {role: "admin", expiresAt: cutoff});
        await user("c-admin", {role: "admin", isActive: false, expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 2});
        expect(await remaining()).toEqual(["a-admin"]);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
    });

    it("a not-yet-due admin is the recovery anchor instead of retaining another overdue admin", async () => {
        await user("recent-admin", {role: "admin", isActive: false, expiresAt: new Date(cutoff.getTime() + 1)});
        await user("old-admin", {role: "admin", expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await remaining()).toEqual(["recent-admin"]);
    });

    it("bounds each batch at 100 and the recovery admin cannot starve later candidates", async () => {
        await shared.db.$transaction(Array.from({length: 103}, (_, i) => shared.db.user.create({data: {
            id: `admin-${String(i).padStart(3, "0")}`, email: `admin-${i}@retention.invalid`,
            password: "synthetic", role: "admin", expiresAt: cutoff,
        }})));
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 100});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 2});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
        expect(await remaining()).toEqual(["admin-000"]);
    });

    it("cascades inline attachments and detached AI jobs; shared image values on other accounts survive", async () => {
        await user("due", {expiresAt: cutoff}); await user("survivor");
        const image = "data:image/png;base64,c3ludGhldGljLW9ubHk=";
        const item = await shared.db.errorItem.create({data: {userId: "due", originalImageUrl: image}});
        const safeItem = await shared.db.errorItem.create({data: {userId: "survivor", originalImageUrl: image}});
        await shared.db.reviewSchedule.create({data: {errorItemId: item.id, scheduledFor: now}});
        await shared.db.practiceRecord.create({data: {userId: "due"}});
        await shared.db.subject.create({data: {userId: "due", name: "Synthetic subject"}});
        await shared.db.knowledgeTag.create({data: {userId: "due", name: "Synthetic tag", subject: "fixture"}});
        const conversation = await shared.db.aiConversation.create({data: {userId: "due", payload: image}});
        const attachedJob = await shared.db.aiJob.create({data: {
            userId: "due", conversationId: conversation.id, kind: "text", requestKey: "attached", input: image, expiresAt: now,
        }});
        await shared.db.aiAttempt.create({data: {jobId: attachedJob.id, modelId: "synthetic", state: "success"}});
        await shared.db.userAiConfiguration.create({data: {userId: "due", payload: "synthetic-no-key"}});
        await job("due"); const safeJob = await job("survivor");
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await shared.db.errorItem.findUnique({where: {id: safeItem.id}})).toMatchObject({originalImageUrl: image});
        expect(await shared.db.aiJob.findUnique({where: {id: safeJob.id}})).not.toBeNull();
        expect(await shared.db.errorItem.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.reviewSchedule.count({where: {errorItemId: item.id}})).toBe(0);
        expect(await shared.db.subject.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.practiceRecord.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.knowledgeTag.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.aiJob.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.aiAttempt.count({where: {jobId: attachedJob.id}})).toBe(0);
        expect(await shared.db.aiConversation.count({where: {userId: "due"}})).toBe(0);
        expect(await shared.db.userAiConfiguration.count({where: {userId: "due"}})).toBe(0);
    });

    it("never interprets imported attachment strings as paths or fetches remote URLs", async () => {
        const sentinel = path.join(fixtureDir, "synthetic-attachment.txt");
        writeFileSync(sentinel, "synthetic-file-must-survive");
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
        await user("due", {expiresAt: cutoff}); await user("survivor");
        const values = [sentinel, `file:///${sentinel.replaceAll("\\", "/")}`, "../../synthetic-attachment.txt", "/uploads/shared.png", "https://example.invalid/image.png", "\\\\server\\share\\image.png"];
        for (const originalImageUrl of values) {
            await shared.db.errorItem.create({data: {userId: "due", originalImageUrl}});
            await shared.db.errorItem.create({data: {userId: "survivor", originalImageUrl}});
        }
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(readFileSync(sentinel, "utf8")).toBe("synthetic-file-must-survive");
        expect(await shared.db.errorItem.count({where: {userId: "survivor"}})).toBe(values.length);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rolls back account, inline attachments and detached jobs if the audit write fails; next invocation retries safely", async () => {
        await user("due", {expiresAt: cutoff}); await job("due");
        await shared.db.errorItem.create({data: {userId: "due", originalImageUrl: "data:image/png;base64,synthetic"}});
        await shared.db.$executeRawUnsafe(`CREATE TRIGGER retention_test_audit_failure BEFORE INSERT ON UserAuditEvent BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`);
        try { await expect(purgeExpiredUsers(now)).rejects.toThrow(); }
        finally { await shared.db.$executeRawUnsafe("DROP TRIGGER retention_test_audit_failure"); }
        expect(await remaining()).toEqual(["due"]);
        expect(await shared.db.aiJob.count({where: {userId: "due"}})).toBe(1);
        expect(await shared.db.errorItem.count({where: {userId: "due"}})).toBe(1);
        expect(await shared.db.userAuditEvent.count()).toBe(0);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
    });

    it("serializes overlapping in-process calls without double deletion or duplicate audits", async () => {
        await user("due", {expiresAt: cutoff});
        await user("a-admin", {role: "admin", expiresAt: cutoff});
        await user("b-admin", {role: "admin", expiresAt: cutoff});
        const results = await Promise.all([purgeExpiredUsers(now), purgeExpiredUsers(now), purgeExpiredUsers(now)]);
        expect(results.reduce((total, result) => total + result.deleted, 0)).toBe(2);
        expect(await remaining()).toEqual(["a-admin"]);
        expect(await shared.db.userAuditEvent.count()).toBe(2);
    });

    it("cleans only elapsed rate-limit windows", async () => {
        await shared.db.authRateLimit.createMany({data: [
            {key: "old", count: 1, windowEnd: now},
            {key: "current", count: 1, windowEnd: new Date(now.getTime() + 1)},
        ]});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
        expect(await shared.db.authRateLimit.findMany({select: {key: true}})).toEqual([{key: "current"}]);
    });

    it.each(["P2034", "P1008"])("retries transient transaction contention (%s)", async code => {
        await user("due", {expiresAt: cutoff});
        const transaction = vi.spyOn(shared.db, "$transaction");
        transaction.mockRejectedValueOnce(Object.assign(new Error("synthetic contention"), {code}));
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(transaction).toHaveBeenCalledTimes(2);
        expect(await shared.db.userAuditEvent.count()).toBe(1);
    });

    it("rechecks a renewed user after retry rather than reusing stale candidate IDs", async () => {
        await user("due", {expiresAt: cutoff});
        const transaction = vi.spyOn(shared.db, "$transaction");
        transaction.mockImplementationOnce(async () => {
            await shared.db.user.update({where: {id: "due"}, data: {expiresAt: null, revision: {increment: 1}}});
            throw Object.assign(new Error("synthetic conflict after renewal"), {code: "P2034"});
        });
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
        expect(await remaining()).toEqual(["due"]);
    });

    it("stops after three contention attempts and allows a later call to succeed", async () => {
        await user("due", {expiresAt: cutoff});
        const failure = Object.assign(new Error("synthetic persistent conflict"), {code: "P2034"});
        const transaction = vi.spyOn(shared.db, "$transaction").mockRejectedValue(failure);
        await expect(purgeExpiredUsers(now)).rejects.toBe(failure);
        expect(transaction).toHaveBeenCalledTimes(3);
        transaction.mockRestore();
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
    });

    it("a renewal holding the SQLite write lock wins against a concurrent purge", async () => {
        await user("due", {expiresAt: cutoff}); await job("due");
        expect(await raceCommittedWrite(tx => tx.user.update({
            where: {id: "due"}, data: {expiresAt: null, revision: {increment: 1}},
        }))).toEqual({deleted: 0});
        expect(await remaining()).toEqual(["due"]);
        expect(await shared.db.aiJob.count({where: {userId: "due"}})).toBe(1);
        expect(await shared.db.userAuditEvent.count()).toBe(0);
    });

    it.each(["demotion", "deletion"])("reselects the last admin after concurrent recovery-anchor %s", async action => {
        await user("keeper", {role: "admin"});
        await user("due-admin", {role: "admin", expiresAt: cutoff});
        expect(await raceCommittedWrite(tx => action === "demotion"
            ? tx.user.update({where: {id: "keeper"}, data: {role: "user", revision: {increment: 1}}})
            : tx.user.delete({where: {id: "keeper"}}))).toEqual({deleted: 0});
        expect(await shared.db.user.findUnique({where: {id: "due-admin"}})).toMatchObject({role: "admin", expiresAt: cutoff});
        expect(await shared.db.userAuditEvent.count()).toBe(0);
    });

    it("when purge wins the write lock a late renewal cannot resurrect or partially delete an account", async () => {
        await user("due", {expiresAt: cutoff}); await job("due");
        const other = new PrismaClient({datasources: {db: {url: fixtureUrl}}});
        const original = shared.db.$transaction.bind(shared.db);
        let renewal: Promise<unknown> | undefined;
        vi.spyOn(shared.db, "$transaction").mockImplementationOnce((callback, options) => original(async tx => {
            const delegate = new Proxy(tx.user, {get(target, prop, receiver) {
                if (prop === "findMany") return async (args: Prisma.UserFindManyArgs) => {
                    const candidates = await target.findMany(args);
                    // Do not await a competing write while this transaction holds the lock.
                    renewal = other.user.update({where: {id: "due"}, data: {expiresAt: null}})
                        .then(() => "unexpected renewal", (error: {code: string}) => error.code);
                    return candidates;
                };
                return Reflect.get(target, prop, receiver);
            }});
            return callback(new Proxy(tx, {get(target, prop, receiver) {
                return prop === "user" ? delegate : Reflect.get(target, prop, receiver);
            }}));
        }, options));
        try {
            expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
            expect(await renewal).toBe("P2025");
            expect(await remaining()).toEqual([]);
            expect(await shared.db.aiJob.count()).toBe(0);
            expect(await shared.db.userAuditEvent.count()).toBe(1);
        } finally { await other.$disconnect(); }
    });
    it("preserves every effective admin without changing expiry or revision", async () => {
        const permanent = await user("permanent-admin", {role: "admin"});
        const temporary = await user("valid-admin", {role: "admin", expiresAt: new Date(now.getTime() + 1)});
        await user("expired-admin", {role: "admin", expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await shared.db.user.findUnique({where: {id: permanent.id}})).toEqual(permanent);
        expect(await shared.db.user.findUnique({where: {id: temporary.id}})).toEqual(temporary);
    });

    it("retains one unchanged recovery account even if every overdue admin is disabled", async () => {
        const recovery = await user("a-disabled-admin", {role: "admin", isActive: false, expiresAt: cutoff});
        await user("b-disabled-admin", {role: "admin", isActive: false, expiresAt: cutoff});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await remaining()).toEqual([recovery.id]);
        expect(await shared.db.user.findUnique({where: {id: recovery.id}})).toEqual(recovery);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
    });

    it("cascades image-bearing dialogue receipts but preserves another account's identical receipt payload", async () => {
        await user("due", {expiresAt: cutoff}); await user("survivor");
        const payload = JSON.stringify({imageBase64: "data:image/png;base64,c3ludGhldGlj"});
        const expired = await shared.db.aiConversation.create({data: {userId: "due", payload}});
        const retained = await shared.db.aiConversation.create({data: {userId: "survivor", payload}});
        const receipt = await shared.db.aiConversationAction.create({data: {
            conversationId: expired.id, requestKey: "initial", payload,
        }});
        const safeReceipt = await shared.db.aiConversationAction.create({data: {
            conversationId: retained.id, requestKey: "initial", payload,
        }});
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 1});
        expect(await shared.db.aiConversationAction.findUnique({where: {id: receipt.id}})).toBeNull();
        expect(await shared.db.aiConversationAction.findUnique({where: {id: safeReceipt.id}})).toEqual(safeReceipt);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 0});
    });

    it("a later account failure rolls back the whole batch, including earlier rows, claims and audits", async () => {
        const first = await user("a-due", {expiresAt: cutoff});
        const second = await user("b-due", {expiresAt: cutoff});
        await job(first.id); await job(second.id);
        await shared.db.authRateLimit.create({data: {key: "elapsed", count: 1, windowEnd: now}});
        await shared.db.$executeRawUnsafe(`CREATE TRIGGER retention_test_late_failure BEFORE INSERT ON UserAuditEvent WHEN NEW.targetId = 'b-due' BEGIN SELECT RAISE(ABORT, 'synthetic later-account failure'); END;`);
        try { await expect(purgeExpiredUsers(now)).rejects.toThrow(); }
        finally { await shared.db.$executeRawUnsafe("DROP TRIGGER retention_test_late_failure"); }
        expect(await shared.db.user.findUnique({where: {id: first.id}})).toEqual(first);
        expect(await shared.db.user.findUnique({where: {id: second.id}})).toEqual(second);
        expect(await shared.db.aiJob.count()).toBe(2);
        expect(await shared.db.userAuditEvent.count()).toBe(0);
        expect(await shared.db.authRateLimit.count()).toBe(1);
        expect(await purgeExpiredUsers(now)).toEqual({deleted: 2});
        expect(await shared.db.aiJob.count()).toBe(0);
        expect(await shared.db.userAuditEvent.count()).toBe(2);
        expect(await shared.db.authRateLimit.count()).toBe(0);
    });

    it("the real enqueue transaction guard prevents a late request from recreating orphan attachments after purge", async () => {
        await user("due", {expiresAt: cutoff});
        let announce!: () => void;
        let release!: () => void;
        const checked = new Promise<void>(resolve => {announce = resolve;});
        const waiting = new Promise<void>(resolve => {release = resolve;});
        shared.authorizeAiInput.mockImplementationOnce(async () => {announce(); await waiting;});
        const result = expect(submitJob("due", "analyze", {questionText: "synthetic retention request"}, "late-fixture"))
            .rejects.toMatchObject({status: 403, message: "AI_ACCESS_REVOKED"});
        await checked;
        try { expect(await purgeExpiredUsers(now)).toEqual({deleted: 1}); }
        finally { release(); }
        await result;
        expect(await shared.db.aiJob.count({where: {userId: "due"}})).toBe(0);
    });
    it("does not retry unexpected database failures", async () => {
        const failure = Object.assign(new Error("synthetic schema error"), {code: "P2021"});
        const transaction = vi.spyOn(shared.db, "$transaction").mockRejectedValue(failure);
        await expect(purgeExpiredUsers(now)).rejects.toBe(failure);
        expect(transaction).toHaveBeenCalledTimes(1);
    });
});
