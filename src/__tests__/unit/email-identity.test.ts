// @vitest-environment node
import {describe, expect, it, vi} from "vitest";
import type {Prisma} from "@prisma/client";
import {assertEmailAvailable, findUniqueEmailIdentity, normalizeEmailIdentity} from "@/lib/user-management/email-identity";
const reader = (rows: Array<{id: string; email: string}>) => ({$queryRaw: vi.fn().mockResolvedValue(rows)});
const transaction = (tx: ReturnType<typeof reader>) => tx as unknown as Prisma.TransactionClient;

describe("transaction-owned email identity", () => {
    it.each([" Test@Example.Invalid ", "\tTEST@EXAMPLE.INVALID\n"])("uses deterministic trim and case folding: %j", value => {
        expect(normalizeEmailIdentity(value)).toBe("test@example.invalid");
    });
    it("does not invent dot/plus or provider aliases", async () => {
        expect(normalizeEmailIdentity("A.B+tag@Example.invalid")).toBe("a.b+tag@example.invalid");
        expect(await findUniqueEmailIdentity(reader([{id: "other", email: "ab@example.invalid"}]), "a.b+tag@example.invalid")).toBeNull();
    });
    it("returns only an unambiguous legacy identity and filters unrelated Unicode candidates", async () => {
        const tx = reader([{id: "other", email: "別人@example.invalid"}, {id: "owner", email: "ÉTUDE@Example.invalid"}]);
        expect(await findUniqueEmailIdentity(tx, " étude@example.invalid ")).toEqual({id: "owner", email: "ÉTUDE@Example.invalid"});
    });
    it.each([{rows: []}, {rows: [{id: "one", email: "OWNER@LOCALHOST"}, {id: "two", email: "owner@localhost"}]}])("returns null for zero or multiple identities", async ({rows}) => {
        expect(await findUniqueEmailIdentity(reader(rows), "owner@localhost")).toBeNull();
    });
    it("uses a parameterized identity-only query without a premature LIMIT or status filter", async () => {
        const tx = reader([]);
        await findUniqueEmailIdentity(tx, " Mixed@Example.invalid ");
        const [parts, value] = tx.$queryRaw.mock.calls[0];
        expect(value).toBe("mixed@example.invalid");
        const sql = (parts as TemplateStringsArray).join("?");
        expect(sql).toContain('SELECT "id", "email"');
        expect(sql).not.toMatch(/password|LIMIT|isActive|expiresAt|mixed@example/i);
        expect(sql).toContain('GLOB');
    });
    it("rejects a collision regardless of legacy stored case", async () => {
        const tx = reader([{id: "old", email: "Owner@Localhost"}]);
        await expect(assertEmailAvailable(transaction(tx), " OWNER@LOCALHOST ")).rejects.toMatchObject({code: "EMAIL_UNAVAILABLE", status: 409});
    });
    it("excludes only the current ID, never the second matching account", async () => {
        const tx = reader([{id: "owner", email: "owner@localhost"}]);
        await expect(assertEmailAvailable(transaction(tx), "owner@localhost", "owner")).resolves.toBeUndefined();
        tx.$queryRaw.mockResolvedValue([{id: "owner", email: "owner@localhost"}, {id: "second", email: "Owner@Localhost"}]);
        await expect(assertEmailAvailable(transaction(tx), "owner@localhost", "owner")).rejects.toMatchObject({code: "EMAIL_UNAVAILABLE"});
    });
    it("allows an available local-domain address in the caller's transaction", async () => {
        const tx = reader([]);
        await expect(assertEmailAvailable(transaction(tx), "new@localhost")).resolves.toBeUndefined();
        expect(tx.$queryRaw).toHaveBeenCalledOnce();
    });
    it("rejects invalid new addresses before reading identities", async () => {
        const tx = reader([]);
        await expect(assertEmailAvailable(transaction(tx), "not an address")).rejects.toThrow();
        expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
});
