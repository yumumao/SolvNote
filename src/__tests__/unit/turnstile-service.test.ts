// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTurnstilePublicConfig, verifyTurnstileToken } from "@/lib/security/turnstile";

const fetchMock = vi.fn();
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
const accepted = { success: true, hostname: "notes.example.test", action: "login" };

beforeEach(() => {
    vi.stubEnv("SOLVNOTE_TURNSTILE_SITE_KEY", "test-public-site-key");
    vi.stubEnv("SOLVNOTE_TURNSTILE_SECRET_KEY", "test-only-private-key");
    vi.stubEnv("SOLVNOTE_TURNSTILE_HOSTNAMES", "notes.example.test, other.example.test");
    vi.stubEnv("NEXTAUTH_URL", "");
    fetchMock.mockReset().mockResolvedValue(response(accepted));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Turnstile public configuration", () => {
    it("exposes only the public site key and complete-configuration flag", () => {
        expect(getTurnstilePublicConfig()).toEqual({ turnstileSiteKey: "test-public-site-key", turnstileConfigured: true });
    });
    it.each(["SOLVNOTE_TURNSTILE_SITE_KEY", "SOLVNOTE_TURNSTILE_SECRET_KEY", "SOLVNOTE_TURNSTILE_HOSTNAMES"])("fails closed without %s", async name => {
        vi.stubEnv(name, "   ");
        expect(getTurnstilePublicConfig().turnstileConfigured).toBe(false);
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("falls back only to the configured NEXTAUTH_URL hostname", async () => {
        vi.stubEnv("SOLVNOTE_TURNSTILE_HOSTNAMES", "");
        vi.stubEnv("NEXTAUTH_URL", "https://notes.example.test:8443/auth");
        expect(getTurnstilePublicConfig().turnstileConfigured).toBe(true);
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(true);
    });
    it.each(["not a url", "javascript://notes.example.test", "https://user:pass@notes.example.test"])("rejects an untrusted or malformed fallback %s", url => {
        vi.stubEnv("SOLVNOTE_TURNSTILE_HOSTNAMES", ""); vi.stubEnv("NEXTAUTH_URL", url);
        expect(getTurnstilePublicConfig().turnstileConfigured).toBe(false);
    });
    it.each(["*.example.test", "https://notes.example.test", "notes.example.test:443", "notes.example.test,", "notes.example.test, bad/host"])("does not hide malformed explicit allowlists with a fallback: %s", hosts => {
        vi.stubEnv("SOLVNOTE_TURNSTILE_HOSTNAMES", hosts); vi.stubEnv("NEXTAUTH_URL", "https://notes.example.test");
        expect(getTurnstilePublicConfig().turnstileConfigured).toBe(false);
    });
    it("normalizes configured hostname case and whitespace without suffix matching", async () => {
        vi.stubEnv("SOLVNOTE_TURNSTILE_HOSTNAMES", " NOTES.EXAMPLE.TEST ,other.example.test ");
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(true);
        fetchMock.mockResolvedValue(response({ ...accepted, hostname: "evil.notes.example.test" }));
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
    });
});

describe("bounded server-side Siteverify", () => {
    it.each([undefined, null, 0, {}, [], "", " \n\t ", "x".repeat(2049)])("rejects a missing, non-string or oversized token before fetching (%#)", async token => {
        expect(await verifyTurnstileToken(token, { expectedAction: "login" })).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("accepts the documented 2048-character boundary and sends exact action-bound validation", async () => {
        expect(await verifyTurnstileToken("x".repeat(2048), { expectedAction: "login", remoteIp: "192.0.2.10" })).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
        expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
        expect(JSON.parse(init.body)).toEqual({ secret: "test-only-private-key", response: "x".repeat(2048), remoteip: "192.0.2.10" });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
    it("does not invent a remote IP and supports registration's distinct action", async () => {
        fetchMock.mockResolvedValue(response({ ...accepted, action: "register" }));
        expect(await verifyTurnstileToken("test-token", { expectedAction: "register" })).toBe(true);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("remoteip");
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
    });
    it.each([
        null, {}, { ...accepted, success: false }, { ...accepted, success: "true" },
        { ...accepted, hostname: "other-attacker.test" }, { ...accepted, hostname: "" },
        { ...accepted, action: "register" }, { ...accepted, action: undefined },
        { success: false, "error-codes": ["timeout-or-duplicate"] },
    ])("rejects failed, expired/replayed, malformed or incorrectly bound responses (%#)", async value => {
        fetchMock.mockResolvedValue(response(value));
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
    });
    it("fails closed on non-2xx responses and invalid JSON", async () => {
        fetchMock.mockResolvedValueOnce(response(accepted, false));
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError("bad response"); } });
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
    });
    it("fails closed on network errors without logging tokens or secrets or retrying", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        fetchMock.mockRejectedValue(new Error("test-only-private-key test-token"));
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    });
    it.each(["fetch", "response body"])("bounds a hung %s to five seconds and aborts it", async phase => {
        vi.useFakeTimers();
        const never = new Promise<never>(() => {});
        fetchMock.mockReturnValue(phase === "fetch" ? never : Promise.resolve({ ok: true, json: () => never }));
        const pending = verifyTurnstileToken("test-token", { expectedAction: "login" });
        let result: boolean | undefined; void pending.then(value => { result = value; });
        await vi.advanceTimersByTimeAsync(4999); expect(result).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1); expect(result).toBe(false);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("clears its deadline after success", async () => {
        vi.useFakeTimers();
        expect(await verifyTurnstileToken("test-token", { expectedAction: "login" })).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
