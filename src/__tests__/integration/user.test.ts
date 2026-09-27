// @vitest-environment node
import {beforeEach, it, expect, vi} from "vitest";
const m = vi.hoisted(() => ({session: vi.fn(), live: vi.fn(), profile: vi.fn(), update: vi.fn(), transaction: vi.fn(), txFind: vi.fn(), txProfile: vi.fn(), updateMany: vi.fn(), identities: vi.fn()}));
vi.mock("next-auth", () => ({getServerSession: m.session}));
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("@/lib/prisma", () => ({prisma: {
    user: {findUnique: m.live, findUniqueOrThrow: m.profile, update: m.update},
    $transaction: m.transaction,
}}));
import {GET, PATCH} from "@/app/api/user/route";
const request = (body: unknown = {}, headers = {}) => new Request("https://app.invalid/api/user", {method: "PATCH", headers: {"Content-Type": "application/json", ...headers}, body: JSON.stringify(body)});
const tx = {user: {findUnique: m.txFind, findUniqueOrThrow: m.txProfile, updateMany: m.updateMany}, $queryRaw: m.identities};
const updatedProfile = {name: "Updated", email: "new@example.invalid", educationStage: "junior_high", enrollmentYear: 2025};
beforeEach(() => {
    vi.resetAllMocks();
    m.session.mockResolvedValue({user: {id: "member", email: "stale@example.invalid", sessionVersion: 0}});
    const member = {id: "member", email: "member@example.invalid", role: "user", isActive: true, sessionVersion: 0, revision: 1, expiresAt: null, mustChangePassword: false};
    m.live.mockResolvedValue(member);
    m.txFind.mockResolvedValue(member);
    m.profile.mockResolvedValue({name: "Member", email: "member@example.invalid"});
    m.txProfile.mockResolvedValue(updatedProfile);
    m.identities.mockResolvedValue([]);
    m.updateMany.mockResolvedValue({count: 1});
    m.transaction.mockImplementation(async action => action(tx));
});
it("uses immutable user ID, not a stale email, and selects no password", async () => {
    const r = await GET(new Request("https://app.invalid/api/user"));
    expect(r.status).toBe(200);
    expect(m.profile.mock.calls[0][0].where).toEqual({id: "member"});
    expect(m.profile.mock.calls[0][0].select.password).toBeUndefined();
});
it.each([null, {id: "member", isActive: false}, {id: "member", isActive: true, sessionVersion: 1}, {id: "member", isActive: true, sessionVersion: 0, expiresAt: new Date(0)}])("rechecks current account state", async live => {
    m.live.mockResolvedValue(live);
    expect((await GET(new Request("https://app.invalid/api/user"))).status).toBe(403);
    expect(m.profile).not.toHaveBeenCalled();
});
it.each([{password: "cannot-bypass-current-password"}, {role: "admin"}, {isActive: true}, {expiresAt: null}, {revision: 1}, {email: "invalid email"}, {name: ""}, {enrollmentYear: 12}])("rejects privileged or invalid profile data: %j", async body => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
});
it("updates permitted fields with transactional CAS and revokes the old email session", async () => {
    const response = await PATCH(request({name: "Updated", email: "NEW@EXAMPLE.INVALID", educationStage: "junior_high", enrollmentYear: 2025}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(updatedProfile);
    expect(m.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {isolationLevel: "Serializable"});
    expect(m.txFind).toHaveBeenCalledExactlyOnceWith({where: {id: "member"}, select: {email: true, revision: true, sessionVersion: true, isActive: true, expiresAt: true, mustChangePassword: true}});
    expect(m.identities).toHaveBeenCalledOnce();
    expect(m.identities.mock.calls[0][1]).toBe("new@example.invalid");
    expect(m.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {id: "member", revision: 1, sessionVersion: 0, isActive: true, mustChangePassword: false, OR: [{expiresAt: null}, {expiresAt: {gt: expect.any(Date)}}]},
        data: {...updatedProfile, revision: {increment: 1}, sessionVersion: {increment: 1}},
    });
    expect(m.txProfile).toHaveBeenCalledExactlyOnceWith({where: {id: "member"}, select: {name: true, email: true, educationStage: true, enrollmentYear: true}});
    expect(m.update).not.toHaveBeenCalled();
    expect(m.profile).not.toHaveBeenCalled();
});
it("enforces same origin", async () => {
    expect((await PATCH(request({name: "Updated"}, {Origin: "https://evil.invalid"}))).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
});
it("does not return database exception details", async () => {
    m.updateMany.mockRejectedValue(new Error("synthetic private diagnostic"));
    const r = await PATCH(request({name: "Updated"}));
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.updateMany).toHaveBeenCalledOnce();
    expect(m.txProfile).not.toHaveBeenCalled();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("synthetic private diagnostic");
});
