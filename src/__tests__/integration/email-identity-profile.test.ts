// @vitest-environment node
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {PrismaClient, type Prisma} from "@prisma/client";
import {AsyncLocalStorage} from "node:async_hooks";
import {copyFileSync, cpSync, mkdirSync, mkdtempSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {hash} from "bcryptjs";
import {NextRequest} from "next/server";

const shared = vi.hoisted(() => ({database: null as unknown as () => PrismaClient, session: vi.fn(), token: vi.fn(), verify: vi.fn()}));
vi.mock("@/lib/prisma", () => ({get prisma() {return shared.database();}}));
vi.mock("next-auth", () => ({getServerSession: shared.session}));
vi.mock("next-auth/jwt", () => ({getToken: shared.token}));
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("@/lib/security/turnstile", () => ({verifyTurnstileToken: shared.verify}));
vi.mock("@/lib/logger", () => ({createLogger: () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()})}));

import {authenticateCredentials} from "@/lib/user-management/authenticate";
import {PATCH, GET} from "@/app/api/user/route";
import {middleware} from "@/middleware";

const context = new AsyncLocalStorage<{db: PrismaClient; id: string}>();
let db: PrismaClient;
let other: PrismaClient;
let passwordHash: string;
const password = "synthetic-legacy-password";
const session = (id = "owner", email = "owner@localhost", sessionVersion = 0) => ({user: {id, email, role: "user", sessionVersion}});
const input = (email: string) => ({email, password, turnstileToken: "synthetic-token"});
const user = (id: string, data: Partial<Prisma.UserCreateInput> = {}) => db.user.create({data: {id, email: `${id}@localhost`, password: passwordHash, ...data}});
const request = (data: unknown) => new Request("https://email-review.invalid/api/user", {
    method: "PATCH", headers: {"Content-Type": "application/json", Origin: "https://email-review.invalid"}, body: JSON.stringify(data),
});

beforeAll(async () => {
    // Only schema/migration source is copied. Prisma runs from the disposable cwd,
    // with an explicit synthetic DB URL, never from the real .env/config directory.
    mkdirSync(".codex/tmp", {recursive: true});
    const dir = mkdtempSync(path.resolve(".codex/tmp/email-identity-profile-"));
    const schemaDir = path.join(dir, "prisma");
    mkdirSync(schemaDir);
    copyFileSync("prisma/schema.prisma", path.join(schemaDir, "schema.prisma"));
    cpSync("prisma/migrations", path.join(schemaDir, "migrations"), {recursive: true});
    const url = "file:" + path.join(dir, "fixture.db").replaceAll("\\", "/");
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
        cwd: dir, env: {...process.env, DATABASE_URL: url}, windowsHide: true, stdio: "pipe",
    });
    db = new PrismaClient({datasources: {db: {url}}});
    other = new PrismaClient({datasources: {db: {url}}});
    await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    shared.database = () => context.getStore()?.db ?? db;
    passwordHash = await hash(password, 4);
}, 30_000);
beforeEach(async () => {
    await db.user.deleteMany();
    await db.authRateLimit.deleteMany();
    await db.userAuditEvent.deleteMany();
    shared.verify.mockReset().mockResolvedValue(true);
    shared.session.mockReset().mockImplementation(async () => session(context.getStore()?.id));
    shared.token.mockReset().mockResolvedValue({id: "owner", email: "owner@localhost", role: "user", sessionVersion: 0});
    vi.stubEnv("NEXTAUTH_URL", "https://email-review.invalid");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network forbidden in email identity tests")));
    await user("owner");
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});
afterAll(async () => {await db?.$disconnect(); await other?.$disconnect();});

async function delayedPatch(data: unknown, concurrentWrite: () => Promise<unknown>) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start(value) {controller = value;}});
    const req = new Request("https://email-review.invalid/api/user", {
        method: "PATCH", headers: {"Content-Type": "application/json", Origin: "https://email-review.invalid"}, body, duplex: "half",
    } as RequestInit & {duplex: "half"});
    const reading = vi.spyOn(req.body!, "getReader");
    const pending = PATCH(req);
    try {
        await vi.waitFor(() => expect(reading).toHaveBeenCalled());
        await concurrentWrite();
    } finally {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
        controller.close();
    }
    return pending;
}

describe.sequential("legacy email identity login", () => {
    it.each(["Legacy@Example.invalid", "legacy@example.invalid", " LEGACY@EXAMPLE.INVALID "])("authenticates one mixed-case stored identity using %s", async email => {
        await user("legacy", {email: "Legacy@Example.invalid"});
        const result = await authenticateCredentials(input(email));
        expect(result).toMatchObject({id: "legacy", email: "Legacy@Example.invalid"});
        expect(result).not.toHaveProperty("password");
    });
    it.each([{}, {isActive: false}, {expiresAt: new Date(0)}])("rejects ambiguous old identities even if the other identity is unusable: %j", async patch => {
        await user("mixed", {email: "Legacy@Example.invalid"});
        await user("lower", {email: "legacy@example.invalid", ...patch});
        expect(await authenticateCredentials(input("Legacy@Example.invalid"))).toBeNull();
        expect(await authenticateCredentials(input("legacy@example.invalid"))).toBeNull();
    });
    it("applies JavaScript lowercase identity consistently to Unicode legacy addresses", async () => {
        await user("unicode", {email: "ÉTUDE@Example.invalid"});
        expect(await authenticateCredentials(input("étude@example.invalid"))).toMatchObject({id: "unicode"});
        await user("unicode-duplicate", {email: "étude@example.invalid"});
        expect(await authenticateCredentials(input("ÉTUDE@Example.invalid"))).toBeNull();
    });
    it("preserves local-domain addresses and legacy short passwords", async () => {
        await db.user.update({where: {id: "owner"}, data: {password: await hash("short", 4)}});
        expect(await authenticateCredentials({...input("OWNER@LOCALHOST"), password: "short"})).toMatchObject({id: "owner"});
    });
});

describe.sequential("profile email transaction and session revocation", () => {
    it("normalizes changed email and atomically increments session version and revision", async () => {
        const response = await PATCH(request({name: "Updated", email: " New@Example.invalid "}));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({name: "Updated", email: "new@example.invalid", educationStage: null, enrollmentYear: null});
        expect(await db.user.findUniqueOrThrow({where: {id: "owner"}})).toMatchObject({email: "new@example.invalid", revision: 2, sessionVersion: 1});
    });
    it.each([{name: "Updated"}, {email: " OWNER@LOCALHOST "}])("does not revoke unchanged identity for %j", async data => {
        expect((await PATCH(request(data))).status).toBe(200);
        expect(await db.user.findUniqueOrThrow({where: {id: "owner"}})).toMatchObject({revision: 2, sessionVersion: 0});
    });
    it("revokes even a case-only stored-email rewrite because old JWT email claims are exact strings", async () => {
        await db.user.update({where: {id: "owner"}, data: {email: "Owner@Localhost"}});
        expect((await PATCH(request({email: "owner@localhost"}))).status).toBe(200);
        expect((await db.user.findUniqueOrThrow({where: {id: "owner"}})).sessionVersion).toBe(1);
    });
    it("rejects another legacy identity's email without partially changing other profile fields", async () => {
        await user("occupied", {email: "Reserved@Example.invalid"});
        const response = await PATCH(request({email: "reserved@example.invalid", name: "Must not persist"}));
        expect(response.status).toBe(409);
        expect(await response.text()).not.toContain("Reserved@Example.invalid");
        expect(await db.user.findUniqueOrThrow({where: {id: "owner"}})).toMatchObject({email: "owner@localhost", name: null, revision: 1, sessionVersion: 0});
    });
    it("rejects a pending JSON write after the session is revoked", async () => {
        const response = await delayedPatch({email: "stale@example.invalid"}, () => db.user.update({where: {id: "owner"}, data: {sessionVersion: {increment: 1}, revision: {increment: 1}}}));
        expect([401, 403]).toContain(response.status);
        expect((await db.user.findUniqueOrThrow({where: {id: "owner"}})).email).toBe("owner@localhost");
    });
    it("rejects a stale profile revision instead of overwriting a concurrent profile edit", async () => {
        const response = await delayedPatch({name: "Stale writer"}, () => db.user.update({where: {id: "owner"}, data: {name: "Winning writer", revision: {increment: 1}}}));
        expect(response.status).toBe(409);
        expect((await db.user.findUniqueOrThrow({where: {id: "owner"}})).name).toBe("Winning writer");
    });
    it.each([{isActive: false}, {expiresAt: new Date(0)}, {mustChangePassword: true}])("rechecks eligibility within the write transaction after body wait: %j", async patch => {
        const response = await delayedPatch({name: "Forbidden writer"}, () => db.user.update({where: {id: "owner"}, data: patch}));
        expect([401, 403]).toContain(response.status);
        expect((await db.user.findUniqueOrThrow({where: {id: "owner"}})).name).toBeNull();
    });
    it("old JWT cannot reach a recycled-email account through middleware or the auth callbacks", async () => {
        expect((await PATCH(request({email: "new@example.invalid"}))).status).toBe(200);
        await user("recycled-owner", {email: "owner@localhost"});
        expect((await middleware(new NextRequest("https://email-review.invalid/api/export")))?.status).toBe(401);
        expect((await GET(new Request("https://email-review.invalid/api/user"))).status).toBe(403);
        // Exercise the real NextAuth callbacks with synthetic claims and the fixture DB.
        const {authOptions} = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
        const jwt = authOptions.callbacks!.jwt!;
        const token = await jwt({token: {id: "owner", email: "owner@localhost", sessionVersion: 0}} as Parameters<typeof jwt>[0]);
        expect(token.invalidSession).toBe(true);
        const toSession = authOptions.callbacks!.session!;
        const result = await toSession({token, session: {...session(), expires: "2030-01-01T00:00:00Z"}} as Parameters<typeof toSession>[0]);
        expect(result.user).toBeUndefined();
    });
    it("two independent SQLite writers cannot claim case variants of the same email", async () => {
        await user("second");
        const responses = await Promise.all([
            context.run({db, id: "owner"}, () => PATCH(request({email: "Shared@Example.invalid"}))),
            context.run({db: other, id: "second"}, () => PATCH(request({email: "shared@example.invalid"}))),
        ]);
        expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
        expect(await db.user.count({where: {email: "shared@example.invalid"}})).toBe(1);
    });
});