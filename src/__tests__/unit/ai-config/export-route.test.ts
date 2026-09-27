// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), load: vi.fn(), seal: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai-access", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/ai-access")>(), requireAdmin: mocks.admin,
}));
vi.mock("@/lib/ai-config/store", () => ({ loadAIConfig: mocks.load }));
vi.mock("@/lib/ai-config/crypto", () => ({ sealExport: mocks.seal }));
import * as route from "@/app/api/ai/config/export/route";
const origin = "https://settings.example.invalid";
const variable = "SOLVNOTE_ENABLE_AI_CONFIG_EXPORT";
const envelope = { format: "portable-ai-config", v: 1, alg: "AES-256-GCM", kdf: "PBKDF2-SHA256", iter: 300000, salt: "synthetic", iv: "synthetic", data: "ciphertext" };
const saved = { version: 1, providers: [{ apiKey: "synthetic-test-key-only" }] };
function request(body: unknown = { password: "synthetic-password-only", revision: 7 }, headers: Record<string, string> = {}) {
    return new Request(origin + "/api/ai/config/export", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function noStore(response: Response) {
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
}
beforeEach(() => {
    vi.stubEnv(variable, undefined); vi.stubEnv("NEXTAUTH_URL", origin);
    mocks.admin.mockReset().mockResolvedValue({ id: "synthetic-admin", role: "admin", sessionVersion: 3 });
    mocks.load.mockReset().mockResolvedValue({ config: saved, revision: 7 });
    mocks.seal.mockReset().mockResolvedValue(envelope);
});
afterEach(() => vi.unstubAllEnvs());
describe("AI config export gate", () => {
    it.each([undefined, "", "false", "1", "yes", "true-not"])("denies %s before parsing the body, reading keys or sealing", async value => {
        vi.stubEnv(variable, value);
        const req = request(); const bodyRead = vi.spyOn(req, "body", "get");
        const response = await route.POST(req);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ message: "AI_CONFIG_EXPORT_DISABLED" });
        noStore(response); expect(bodyRead).not.toHaveBeenCalled();
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    });
    it("cannot be enabled by body, query, headers or public environment aliases", async () => {
        vi.stubEnv("NEXT_PUBLIC_SOLVNOTE_ENABLE_AI_CONFIG_EXPORT", "true");
        const req = new Request(origin + "/api/ai/config/export?exportEnabled=true", {
            method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Export-Enabled": "true", [variable]: "true" },
            body: JSON.stringify({ exportEnabled: true, [variable]: "true", password: "synthetic-password-only", revision: 7 }),
        });
        const response = await route.POST(req);
        expect(await response.json()).toEqual({ message: "AI_CONFIG_EXPORT_DISABLED" });
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    });
    it("preserves explicit server enablement, saved revision, encryption and headers", async () => {
        vi.stubEnv(variable, "  TrUe ");
        const response = await route.POST(request());
        expect(response.status).toBe(200); expect(await response.json()).toEqual(envelope);
        expect(mocks.load).toHaveBeenCalledWith({ persist: false });
        expect(mocks.seal).toHaveBeenCalledWith(saved, "synthetic-password-only");
        expect(response.headers.get("content-disposition")).toContain("attachment;");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff"); noStore(response);
    });
    it.each([401, 403, 503])("preserves live guard denial %s with either gate value", async status => {
        for (const value of ["false", "true"]) {
            vi.stubEnv(variable, value);
            mocks.admin.mockRejectedValue(Object.assign(Error("synthetic-private-auth-error"), { status }));
            const response = await route.POST(request());
            expect(response.status).toBe(status); noStore(response);
            expect(await response.text()).not.toContain("synthetic-private");
        }
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    });
    it("preserves same-origin rejection before configuration access", async () => {
        vi.stubEnv(variable, "true");
        const response = await route.POST(request(undefined, { Origin: "https://foreign.invalid" }));
        expect(response.status).toBe(403); noStore(response);
        expect(await response.json()).toEqual({ message: "IMPORT_ORIGIN_REJECTED" });
        expect(mocks.load).not.toHaveBeenCalled();
    });
    it("preserves revision conflicts without encryption", async () => {
        vi.stubEnv(variable, "true");
        const response = await route.POST(request({ password: "synthetic-password-only", revision: 6 }));
        expect(response.status).toBe(409); expect(await response.json()).toEqual({ message: "CONFIG_CONFLICT" });
        expect(mocks.seal).not.toHaveBeenCalled(); noStore(response);
    });
    it("preserves bounded JSON and passphrase validation", async () => {
        vi.stubEnv(variable, "true");
        for (const [req, status] of [[request(undefined, {"Content-Type":"text/plain"}), 415], [request({password:"x".repeat(9000),revision:7}),413], [request({password:"short",revision:7}),400]] as const) {
            const response = await route.POST(req); expect(response.status).toBe(status); noStore(response);
        }
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    });
});
describe("server capability endpoint", () => {
    it.each([undefined, "false", "true"])("returns only the server boolean for %s without reading configuration", async value => {
        vi.stubEnv(variable, value);
        expect(route).toHaveProperty("GET");
        const response = await route.GET(new Request(origin + "/api/ai/config/export?exportEnabled=true"));
        expect(response.status).toBe(200); noStore(response);
        expect(await response.json()).toEqual({ exportEnabled: value === "true" });
        expect(mocks.admin).toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.seal).not.toHaveBeenCalled();
    });
    it.each([401, 403, 503])("does not bypass the admin guard: %s", async status => {
        mocks.admin.mockRejectedValue(Object.assign(Error("synthetic-private-auth-error"), { status }));
        expect(route).toHaveProperty("GET");
        const response = await route.GET(new Request(origin + "/api/ai/config/export"));
        expect(response.status).toBe(status); noStore(response);
        expect(await response.text()).not.toContain("synthetic-private");
        expect(mocks.load).not.toHaveBeenCalled();
    });
});

// Explicit operator opt-in must not turn export into a stale-session escape hatch.
describe("enabled export live revocation", () => {
    it.each(["guard", "version"])("rechecks %s after an untrusted body before reading saved keys", async kind => {
        vi.stubEnv(variable, "true");
        mocks.admin.mockResolvedValueOnce({id:"synthetic-admin",role:"admin",sessionVersion:3});
        if(kind === "guard") mocks.admin.mockRejectedValue(Object.assign(Error("revoked"),{status:403}));
        else mocks.admin.mockResolvedValue({id:"synthetic-admin",role:"admin",sessionVersion:4});
        const response=await route.POST(request());
        expect(response.status).toBe(403);noStore(response);
        expect(mocks.load).not.toHaveBeenCalled();expect(mocks.seal).not.toHaveBeenCalled();
    });
    it("does not release the envelope after revocation during encryption", async () => {
        vi.stubEnv(variable, "true");
        mocks.seal.mockImplementation(async () => {
            mocks.admin.mockResolvedValue({id:"synthetic-admin",role:"admin",sessionVersion:4});
            return envelope;
        });
        const response=await route.POST(request());
        expect(response.status).toBe(403);noStore(response);
        expect(await response.text()).not.toContain("ciphertext");
    });
});
