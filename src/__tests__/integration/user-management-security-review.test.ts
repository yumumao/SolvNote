// @vitest-environment node
// Independent security review: only disposable SQLite and synthetic credentials.
// Every security invariant is a normal assertion: no expected-failure masking.
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {PrismaClient, type Prisma} from "@prisma/client";
import {AsyncLocalStorage} from "node:async_hooks";
import {copyFileSync, cpSync, mkdirSync, mkdtempSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {hash} from "bcryptjs";

const shared = vi.hoisted(() => ({
    database: null as unknown as () => PrismaClient,
    session: vi.fn(), verify: vi.fn(), network: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({get prisma() { return shared.database(); }}));
vi.mock("next-auth", () => ({getServerSession: shared.session}));
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("@/lib/security/turnstile", () => ({
    verifyTurnstileToken: shared.verify,
    getTurnstilePublicConfig: () => ({turnstileSiteKey: "synthetic", turnstileConfigured: true}),
}));
vi.mock("@/lib/ai-access/bootstrap", () => ({ensureInitialAiPolicy: vi.fn()}));
vi.mock("@/lib/ai-access/registration", () => ({createInitialAiGrants: vi.fn()}));
// Never load the real config/vault, filesystem keys, or network AI.
vi.mock("@/lib/ai-config/vault", () => ({
    masterKey: vi.fn(), protect: (value: unknown) => JSON.stringify(value),
    unprotect: (value: string) => JSON.parse(value),
}));
vi.mock("@/lib/logger", () => ({createLogger: () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()})}));

import {authenticateCredentials} from "@/lib/user-management/authenticate";
import {registerUser} from "@/lib/user-management/registration";
import {hashInvite} from "@/lib/user-management/registration-settings";
import {deleteManagedUser, updateManagedUser} from "@/lib/user-management/users";
import {POST as createUserRoute} from "@/app/api/admin/users/route";
import {GET as getProfile, PATCH as patchProfile} from "@/app/api/user/route";
import {POST as openclawUpload} from "@/app/api/openclaw/batch-upload/route";

const reviewInvariant = it;
const context = new AsyncLocalStorage<PrismaClient>();
const now = new Date("2026-09-27T00:00:00Z");
const password = "Synthetic-review-passphrase-only";
let db: PrismaClient;
let other: PrismaClient;
let passwordHash: string;

beforeAll(async () => {
    mkdirSync(".codex/tmp", {recursive: true});
    const dir = mkdtempSync(path.resolve(".codex/tmp/user-security-review-"));
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
    shared.database = () => context.getStore() ?? db;
    passwordHash = await hash(password, 4);
}, 30_000);
beforeEach(async () => {
    await db.user.deleteMany();
    await db.invitationCode.deleteMany();
    await db.registrationSettings.deleteMany();
    await db.authRateLimit.deleteMany();
    await db.userAuditEvent.deleteMany();
    shared.verify.mockReset().mockResolvedValue(true);
    shared.session.mockReset().mockResolvedValue({user: {id: "admin-a", role: "admin", sessionVersion: 0}});
    shared.network.mockReset().mockRejectedValue(new Error("Unexpected network access in security review"));
    vi.stubGlobal("fetch", shared.network);
    vi.stubEnv("NEXTAUTH_URL", "https://review.example.invalid");
    vi.stubEnv("OPENCLAW_API_URL", "https://openclaw.example.invalid");
    vi.stubEnv("OPENCLAW_API_KEY", "synthetic-review-only");
    vi.stubEnv("SOLVNOTE_TRUST_PROXY_HEADERS", "false");
    await user("admin-a", {role: "admin"});
    await user("admin-b", {role: "admin"});
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});
afterAll(async () => {await db?.$disconnect(); await other?.$disconnect();});
const user = (id: string, data: Partial<Prisma.UserCreateInput> = {}) => db.user.create({
    data: {id, email: `${id}@review.invalid`, password: passwordHash, ...data},
});
const input = (email: string) => ({email, password, name: "Synthetic review", turnstileToken: "synthetic-token"});
const request = (route: string, body?: unknown, method = "POST") => new Request("https://review.example.invalid" + route, {
    method, headers: {"Content-Type": "application/json", Origin: "https://review.example.invalid"},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});
const enable = () => db.registrationSettings.create({data: {id: "site", enabled: true, inviteRequired: true}});
const invite = () => db.invitationCode.create({data: {
    id: "single-use", codeHash: hashInvite("synthetic-invite"), encryptedCode: "not-a-real-vault",
    createdById: "admin-a", expiresAt: new Date(now.getTime() + 86_400_000),
}});
const activeAdmins = () => db.user.count({where: {
    role: "admin", isActive: true, OR: [{expiresAt: null}, {expiresAt: {gt: now}}],
}});

describe.sequential("independent security review controls", () => {
    it("single-use invite cannot be spent twice over two real SQLite clients", async () => {
        await enable(); await invite();
        const results = await Promise.allSettled([
            context.run(db, () => registerUser({...input("first@review.invalid"), inviteCode: "synthetic-invite"}, {}, now)),
            context.run(other, () => registerUser({...input("second@review.invalid"), inviteCode: "synthetic-invite"}, {}, now)),
        ]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(await db.invitationUse.count()).toBe(1);
        expect((await db.invitationCode.findUniqueOrThrow({where: {id: "single-use"}})).usedCount).toBe(1);
    });
    it("failed registration rolls back the invite claim", async () => {
        await enable(); await invite();
        await expect(registerUser({...input("admin-a@review.invalid"), inviteCode: "synthetic-invite"}, {}, now)).rejects.toThrow();
        expect(await db.invitationUse.count()).toBe(0);
        expect((await db.invitationCode.findUniqueOrThrow({where: {id: "single-use"}})).usedCount).toBe(0);
    });
    it.each(["disable", "demote", "delete"] as const)("concurrent cross-%s preserves the last effective admin", async operation => {
        const mutate = (actor: string, target: string) => operation === "delete"
            ? deleteManagedUser(actor, target, {revision: 1}, now)
            : updateManagedUser(actor, target, {revision: 1, ...(operation === "disable" ? {isActive: false} : {role: "user"})}, now);
        const results = await Promise.allSettled([
            context.run(db, () => mutate("admin-a", "admin-b")),
            context.run(other, () => mutate("admin-b", "admin-a")),
        ]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(await activeAdmins()).toBe(1);
    });
    it("expired/disabled admins are not counted as recovery-capable peers", async () => {
        await db.user.update({where: {id: "admin-b"}, data: {expiresAt: now}});
        await user("disabled-admin", {role: "admin", isActive: false});
        await expect(updateManagedUser("admin-b", "admin-a", {revision: 1, role: "user"}, now)).rejects.toThrow("ADMIN_AUTHORIZATION_REVOKED");
        expect(await activeAdmins()).toBe(1);
    });
    it("legacy short passwords and local-domain email still work for lowercase stored addresses", async () => {
        await user("legacy-lower", {email: "legacy@localhost", password: await hash("short", 4)});
        expect(await authenticateCredentials({...input(" LEGACY@LOCALHOST "), password: "short"})).toMatchObject({id: "legacy-lower"});
    });
    it("legacy profile whitelist rejects privilege, password and expiry injection", async () => {
        const response = await patchProfile(request("/api/user", {role: "admin", password, expiresAt: null}, "PATCH"));
        expect(response.status).toBe(400);
        expect((await db.user.findUniqueOrThrow({where: {id: "admin-a"}})).revision).toBe(1);
        const profile = await getProfile(request("/api/user", undefined, "GET"));
        expect(Object.keys(await profile.json()).sort()).toEqual(["educationStage", "email", "enrollmentYear", "name"]);
    });
    it("Openclaw rejects foreign subjects before invoking the provider", async () => {
        const subject = await db.subject.create({data: {name: "Synthetic subject", userId: "admin-b"}});
        const response = await openclawUpload(request("/api/openclaw/batch-upload", {subjectId: subject.id, images: []}));
        expect(response.status).toBe(403); expect(shared.network).not.toHaveBeenCalled();
    });
    it("management responses exclude password hashes/session versions and prohibit caching", async () => {
        const response = await createUserRoute(request("/api/admin/users", {name: "Synthetic", email: "created@review.invalid"}));
        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const result = await response.json();
        expect(result.user).not.toHaveProperty("password");
        expect(result.user).not.toHaveProperty("sessionVersion");
        expect(typeof result.temporaryPassword).toBe("string");
    });
});

describe.sequential("security regression invariants", () => {
    it.each(["role", "session-reset", "disabled", "expired"])("revoking admin %s while JSON is pending prevents creation", async reason => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({start(value) {controller = value;}});
        const req = new Request("https://review.example.invalid/api/admin/users", {
            method: "POST", headers: {"Content-Type": "application/json", Origin: "https://review.example.invalid"},
            body, duplex: "half",
        } as RequestInit & {duplex: "half"});
        const reading = vi.spyOn(req.body!, "getReader");
        const pending = createUserRoute(req);
        try {
            await vi.waitFor(() => expect(reading).toHaveBeenCalled());
            if (reason === "role") await updateManagedUser("admin-b", "admin-a", {revision: 1, role: "user"});
            else await db.user.update({where: {id: "admin-a"}, data: reason === "session-reset" ? {sessionVersion: {increment: 1}} : reason === "disabled" ? {isActive: false} : {expiresAt: new Date(0)}});
        } finally {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({name: "Synthetic", email: "resurrected@review.invalid", role: "admin"})));
            controller.close();
        }
        const response = await pending;
        const escaped = await db.user.count({where: {email: "resurrected@review.invalid", role: "admin"}});
        expect({status: response.status, escaped}).toEqual({status: 403, escaped: 0});
    });
    reviewInvariant("migration must preserve login for an existing mixed-case email", async () => {
        await user("legacy-mixed", {email: "Legacy@Example.invalid"});
        const result = await authenticateCredentials(input("Legacy@Example.invalid"));
        expect(result).toMatchObject({id: "legacy-mixed"});
    });
    reviewInvariant("registration must not create a lowercase shadow of a legacy mixed-case address", async () => {
        await user("legacy-mixed", {email: "Legacy@Example.invalid"});
        await db.registrationSettings.create({data: {id: "site", enabled: true, inviteRequired: false}});
        await expect(registerUser(input("legacy@example.invalid"), {}, now)).rejects.toThrow();
    });
    reviewInvariant("unverified login attempts must not exhaust every user's shared login bucket", async () => {
        shared.verify.mockResolvedValue(false);
        for (let i = 0; i < 100; i++) {
            expect(await authenticateCredentials(input(`attacker-${i}@review.invalid`))).toBeNull();
        }
        shared.verify.mockResolvedValue(true);
        expect(await authenticateCredentials(input("admin-a@review.invalid"))).toMatchObject({id: "admin-a"});
    });
    reviewInvariant("Openclaw errors must not return raw provider diagnostics to ordinary users", async () => {
        await user("ordinary");
        shared.session.mockResolvedValue({user: {id: "ordinary", role: "user", sessionVersion: 0}});
        const sensitiveDiagnostic = "SYNTHETIC_UPSTREAM_PRIVATE_DIAGNOSTIC";
        shared.network.mockResolvedValue(new Response(JSON.stringify({success: false, error: sensitiveDiagnostic}), {status: 200}));
        const response = await openclawUpload(request("/api/openclaw/batch-upload", {
            images: [{base64: "c3ludGhldGlj", filename: "synthetic.png", mimeType: "image/png"}],
        }));
        expect(response.status).toBe(207);
        expect(await response.text()).not.toContain(sensitiveDiagnostic);
    });
});