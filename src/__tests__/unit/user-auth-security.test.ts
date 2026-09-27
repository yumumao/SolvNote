// @vitest-environment node
import {beforeEach, describe, it, expect, vi} from "vitest";
const m = vi.hoisted(() => ({user: vi.fn(), identities: vi.fn(), transaction: vi.fn(), verify: vi.fn(), limit: vi.fn(), compare: vi.fn()}));
vi.mock("@/lib/prisma", () => ({prisma: {$transaction: m.transaction}}));
vi.mock("@/lib/security/turnstile", () => ({verifyTurnstileToken: m.verify}));
vi.mock("@/lib/user-management/rate-limit", () => ({limitAuthentication: m.limit, requestIp: () => undefined}));
vi.mock("bcryptjs", () => ({compare: m.compare}));
import {authenticateCredentials} from "@/lib/user-management/authenticate";
const credentials = {email: "TEST@EXAMPLE.INVALID", password: "legacy-short", turnstileToken: "synthetic-token"};
beforeEach(() => {
    vi.resetAllMocks();
    m.limit.mockResolvedValue(true);
    m.verify.mockResolvedValue(true);
    m.compare.mockResolvedValue(true);
    m.identities.mockResolvedValue([{id: "user", email: "test@example.invalid"}]);
    m.transaction.mockImplementation(async action => action({$queryRaw: m.identities, user: {findUnique: m.user}}));
    m.user.mockResolvedValue({id: "user", email: "test@example.invalid", password: "hashed", isActive: true, role: "user", sessionVersion: 2, mustChangePassword: false, expiresAt: null});
});
describe("credential boundary", () => {
    it("verifies login action before querying identity, then loads the immutable ID and preserves legacy passwords", async () => {
        const user = await authenticateCredentials(credentials);
        expect(user).toMatchObject({id: "user", sessionVersion: 2});
        expect(user).not.toHaveProperty("password");
        expect(m.verify).toHaveBeenCalledWith("synthetic-token", {expectedAction: "login", remoteIp: undefined});
        expect(m.identities.mock.invocationCallOrder[0]).toBeGreaterThan(m.verify.mock.invocationCallOrder[0]);
        expect(m.user).toHaveBeenCalledWith({where: {id: "user"}});
        expect(m.compare).toHaveBeenCalledWith(credentials.password, "hashed");
    });
    it.each([null, {}, {...credentials, turnstileToken: ""}])("rejects missing credentials or token", async input => {
        expect(await authenticateCredentials(input)).toBeNull();
        expect(m.transaction).not.toHaveBeenCalled();
    });
    it("fails closed on verification and rate limiting before reading any identity", async () => {
        m.verify.mockResolvedValue(false);
        expect(await authenticateCredentials(credentials)).toBeNull();
        expect(m.identities).not.toHaveBeenCalled();
        m.limit.mockResolvedValue(false);
        m.verify.mockClear();
        expect(await authenticateCredentials(credentials)).toBeNull();
        expect(m.verify).not.toHaveBeenCalled();
        expect(m.transaction).not.toHaveBeenCalled();
    });
    it.each([{isActive: false}, {expiresAt: new Date(0)}, null])("blocks disabled expired and missing accounts", async patch => {
        m.user.mockResolvedValue(patch ? {id: "user", password: "hash", isActive: true, expiresAt: null, ...patch} : null);
        expect(await authenticateCredentials(credentials)).toBeNull();
        expect(m.compare).not.toHaveBeenCalled();
    });
    it("accepts a unique mixed-case legacy email", async () => {
        m.identities.mockResolvedValue([{id: "user", email: "Test@Example.Invalid"}]);
        expect(await authenticateCredentials({...credentials, email: " TEST@example.invalid "})).toMatchObject({id: "user"});
    });
    it.each([{identities: []}, {identities: [{id: "user", email: "Test@Example.Invalid"}, {id: "other", email: "test@example.invalid"}]}])("rejects absent or ambiguous identities without reading passwords", async ({identities}) => {
        m.identities.mockResolvedValue(identities);
        expect(await authenticateCredentials(credentials)).toBeNull();
        expect(m.user).not.toHaveBeenCalled();
        expect(m.compare).not.toHaveBeenCalled();
    });
    it("does not leak dependency errors", async () => {
        m.verify.mockRejectedValue(new Error("synthetic upstream diagnostic"));
        expect(await authenticateCredentials(credentials)).toBeNull();
    });
    it("fails closed on identity read errors", async () => {
        m.identities.mockRejectedValue(new Error("synthetic database diagnostic"));
        expect(await authenticateCredentials(credentials)).toBeNull();
        expect(m.compare).not.toHaveBeenCalled();
    });
    it("rejects an incorrect password", async () => {
        m.compare.mockResolvedValue(false);
        expect(await authenticateCredentials(credentials)).toBeNull();
    });
});
