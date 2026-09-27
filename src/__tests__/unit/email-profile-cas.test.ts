// @vitest-environment node
// Pure in-memory test doubles only: no Prisma client, files, migrations or network.
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({session: vi.fn(), find: vi.fn(), profile: vi.fn(), legacyUpdate: vi.fn(), transaction: vi.fn(), txFind: vi.fn(), txProfile: vi.fn(), updateMany: vi.fn(), identities: vi.fn()}));
vi.mock("next-auth", () => ({getServerSession: m.session}));
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("@/lib/prisma", () => ({prisma: {user: {findUnique: m.find, findUniqueOrThrow: m.profile, update: m.legacyUpdate}, $transaction: m.transaction}}));
import {PATCH, GET} from "@/app/api/user/route";

type Account = {id: string; email: string; name: string; revision: number; sessionVersion: number; isActive: boolean; expiresAt: Date | null; mustChangePassword: boolean; role: string; educationStage: null; enrollmentYear: null};
let state: Account | null;
const safeProfile = () => ({name: state!.name, email: state!.email, educationStage: state!.educationStage, enrollmentYear: state!.enrollmentYear});
const apply = (data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (typeof value === "object" && value !== null && "increment" in value) {
            const field = key as "revision" | "sessionVersion";
            state![field] += Number(value.increment);
        } else Object.assign(state!, {[key]: value});
    }
};
const request = (data: unknown) => new Request("https://profile-unit.invalid/api/user", {method: "PATCH", headers: {"Content-Type": "application/json", Origin: "https://profile-unit.invalid"}, body: JSON.stringify(data)});
const tx = {user: {findUnique: m.txFind, findUniqueOrThrow: m.txProfile, updateMany: m.updateMany}, $queryRaw: m.identities};

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXTAUTH_URL", "https://profile-unit.invalid");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network forbidden in unit tests")));
    state = {id: "owner", email: "owner@localhost", name: "Original", revision: 1, sessionVersion: 0, role: "user", isActive: true, expiresAt: null, mustChangePassword: false, educationStage: null, enrollmentYear: null};
    m.session.mockResolvedValue({user: {id: "owner", email: "owner@localhost", sessionVersion: 0}});
    m.find.mockImplementation(async () => state ? {...state} : null);
    m.profile.mockImplementation(async () => safeProfile());
    m.txFind.mockImplementation(async () => state ? {...state} : null);
    m.txProfile.mockImplementation(async () => safeProfile());
    m.identities.mockImplementation(async () => state ? [{id: state.id, email: state.email}] : []);
    m.transaction.mockImplementation(async action => action(tx));
    m.updateMany.mockImplementation(async ({data}) => {apply(data); return {count: 1};});
    // The old route's non-transactional update is modeled to make the regressions fail for behavior, not missing mocks.
    m.legacyUpdate.mockImplementation(async ({data}) => {apply(data); return safeProfile();});
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

async function delayed(data: unknown, mutate: () => void) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start(value) {controller = value;}});
    const req = new Request("https://profile-unit.invalid/api/user", {method: "PATCH", headers: {"Content-Type": "application/json", Origin: "https://profile-unit.invalid"}, body, duplex: "half"} as RequestInit & {duplex: "half"});
    const reading = vi.spyOn(req.body!, "getReader");
    const pending = PATCH(req);
    try {await vi.waitFor(() => expect(reading).toHaveBeenCalled()); mutate();}
    finally {controller.enqueue(new TextEncoder().encode(JSON.stringify(data))); controller.close();}
    return pending;
}

describe("profile transaction, compare-and-swap and session revocation", () => {
    it("normalizes a changed email, increments both versions and returns only no-store profile fields", async () => {
        const response = await PATCH(request({name: "Updated", email: " New@Example.invalid "}));
        expect(response.status).toBe(200);
        expect(state).toMatchObject({email: "new@example.invalid", name: "Updated", revision: 2, sessionVersion: 1});
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({name: "Updated", email: "new@example.invalid", educationStage: null, enrollmentYear: null});
        expect(m.legacyUpdate).not.toHaveBeenCalled();
        expect(m.transaction).toHaveBeenCalledOnce();
    });
    it.each([{name: "Updated"}, {email: " OWNER@LOCALHOST "}])("does not revoke an unchanged stored email: %j", async data => {
        expect((await PATCH(request(data))).status).toBe(200);
        expect(state).toMatchObject({revision: 2, sessionVersion: 0});
        expect(m.updateMany).toHaveBeenCalledOnce();
    });
    it("revokes even a case-only persisted email rewrite", async () => {
        state!.email = "Owner@Localhost";
        expect((await PATCH(request({email: "owner@localhost"}))).status).toBe(200);
        expect(state!.sessionVersion).toBe(1);
    });
    it("does not read other email identities for a name-only update", async () => {
        expect((await PATCH(request({name: "Updated"}))).status).toBe(200);
        expect(m.identities).not.toHaveBeenCalled();
    });
    it("rejects legacy case-insensitive conflicts before writing any field", async () => {
        m.identities.mockResolvedValue([{id: "other", email: "Reserved@Example.invalid"}]);
        const response = await PATCH(request({name: "Must not persist", email: "reserved@example.invalid"}));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({error: "EMAIL_UNAVAILABLE"});
        expect(state).toMatchObject({name: "Original", revision: 1, sessionVersion: 0});
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it("rejects revoked authentication after waiting for JSON", async () => {
        const response = await delayed({email: "stale@example.invalid"}, () => {state!.sessionVersion++; state!.revision++;});
        expect([401, 403]).toContain(response.status);
        expect(state!.email).toBe("owner@localhost");
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it("rejects a stale revision rather than overwriting a concurrent edit", async () => {
        const response = await delayed({name: "Stale"}, () => {state!.revision++; state!.name = "Winner";});
        expect(response.status).toBe(409);
        expect(state!.name).toBe("Winner");
    });
    it.each([{isActive: false}, {expiresAt: new Date(0)}, {mustChangePassword: true}])("rechecks live eligibility inside the transaction: %j", async patch => {
        const response = await delayed({name: "Forbidden"}, () => Object.assign(state!, patch));
        expect([401, 403]).toContain(response.status);
        expect(state!.name).toBe("Original");
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it("rejects a deleted account after waiting for JSON", async () => {
        const response = await delayed({name: "Forbidden"}, () => {state = null;});
        expect([401, 403]).toContain(response.status);
        expect(m.updateMany).not.toHaveBeenCalled();
    });
    it("anchors the final CAS to immutable ID, revision, session version and account eligibility", async () => {
        expect((await PATCH(request({name: "Updated"}))).status).toBe(200);
        expect(m.updateMany).toHaveBeenCalledWith(expect.objectContaining({where: expect.objectContaining({id: "owner", revision: 1, sessionVersion: 0, isActive: true, mustChangePassword: false, OR: [{expiresAt: null}, {expiresAt: {gt: expect.any(Date)}}]})}));
    });
    it("returns conflict instead of reporting success when the CAS loses", async () => {
        m.updateMany.mockResolvedValue({count: 0});
        expect((await PATCH(request({email: "new@example.invalid"}))).status).toBe(409);
        expect(state).toMatchObject({email: "owner@localhost", revision: 1, sessionVersion: 0});
    });
    it.each(["P2002", "P2034", "P1008"])("sanitizes and maps retryable database conflict %s", async code => {
        m.transaction.mockRejectedValue({code, message: "synthetic private diagnostic"});
        const response = await PATCH(request({email: "new@example.invalid"}));
        expect(response.status).toBe(409);
        expect(await response.text()).not.toContain("synthetic private diagnostic");
    });
    it("sanitizes unexpected transaction errors", async () => {
        m.transaction.mockRejectedValue(new Error("synthetic private diagnostic"));
        const response = await PATCH(request({name: "Updated"}));
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("synthetic private diagnostic");
    });
    it("the old session cannot read a profile after its email has changed", async () => {
        expect((await PATCH(request({email: "new@example.invalid"}))).status).toBe(200);
        expect((await GET(new Request("https://profile-unit.invalid/api/user"))).status).toBe(403);
    });
    it.each([{sessionVersion: 10}, {revision: 100}, {role: "admin"}, {email: "invalid address"}])("keeps strict profile input: %j", async data => {
        expect((await PATCH(request(data))).status).toBe(400);
        expect(m.updateMany).not.toHaveBeenCalled();
    });
});
