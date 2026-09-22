// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
    prisma: { user: { findUnique: mocks.user } },
}));
import { requireUser, requireAdmin, assertSameOrigin } from "@/lib/ai-access";
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXTAUTH_URL", undefined);
    mocks.session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    mocks.user.mockResolvedValue({ id: "u1", role: "user", isActive: true });
});
afterEach(() => {
    vi.unstubAllEnvs();
});
describe("shared AI access boundary", () => {
    it("only returns ID and the current DB role", async () => {
        expect(await requireUser()).toEqual({ id: "u1", role: "user" });
        expect(mocks.user).toHaveBeenCalledWith({
            where: { id: "u1" },
            select: { id: true, role: true, isActive: true },
        });
    });
    it("requires an active database admin, not a session role", async () => {
        await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
        mocks.user.mockResolvedValue({
            id: "u1",
            role: "admin",
            isActive: true,
        });
        expect(await requireAdmin()).toEqual({ id: "u1", role: "admin" });
    });
    it.each([null, { user: {} }, { user: { id: "" } }])(
        "rejects missing session IDs: %j",
        async (session) => {
            mocks.session.mockResolvedValue(session);
            await expect(requireUser()).rejects.toMatchObject({ status: 401 });
            expect(mocks.user).not.toHaveBeenCalled();
        },
    );
    it.each([null, { id: "u1", role: "admin", isActive: false }])(
        "rejects disabled/deleted accounts: %j",
        async (user) => {
            mocks.user.mockResolvedValue(user);
            await expect(requireUser()).rejects.toMatchObject({ status: 403 });
        },
    );
    it("sanitizes session and DB errors", async () => {
        mocks.user.mockRejectedValue(new Error("fixture-database-secret"));
        const error = await requireAdmin().catch((error: Error) => error);
        expect(error).toMatchObject({ status: 503 });
        expect(String(error)).not.toContain("fixture-");
    });
    it.each<Record<string, string>>([
        {},
        { Origin: "https://app.example.com" },
        { "Sec-Fetch-Site": "none" },
        { Origin: "https://app.example.com", "Sec-Fetch-Site": "same-origin" },
    ])("allows same-origin or nonbrowser requests: %j", (headers) => {
        expect(() =>
            assertSameOrigin(
                new Request("https://app.example.com/api", { headers }),
            ),
        ).not.toThrow();
    });
    it.each<Record<string, string>>([
        { Origin: "null" },
        { Origin: "https://evil.example.com" },
        { Origin: "https://app.example.com/other" },
        { "Sec-Fetch-Site": "cross-site" },
        { "Sec-Fetch-Site": "same-site" },
        { "Sec-Fetch-Site": "invalid" },
        {
            Origin: "https://evil.example.com",
            "X-Forwarded-Host": "evil.example.com",
        },
    ])(
        "rejects forged origins and browser cross-site metadata: %j",
        (headers) => {
            expect(() =>
                assertSameOrigin(
                    new Request("https://app.example.com/api", { headers }),
                ),
            ).toThrow(expect.objectContaining({ status: 403 }));
        },
    );
});
describe("canonical same-origin checks behind an HTTPS reverse proxy", () => {
    const canonical = "https://notebook.example.com";
    const internal = "http://ai-service:3000/api/ai/config";
    function proxied(headers: HeadersInit = {}) {
        const values = new Headers({
            Origin: canonical,
            "Sec-Fetch-Site": "same-origin",
        });
        new Headers(headers).forEach((value, name) => values.set(name, value));
        return new Request(internal, { method: "POST", headers: values });
    }

    it("accepts canonical HTTPS Origin despite the internal HTTP request URL", () => {
        vi.stubEnv("NEXTAUTH_URL", canonical);
        expect(() => assertSameOrigin(proxied())).not.toThrow();
    });
    it("uses the URL origin even when NEXTAUTH_URL includes an auth base path", () => {
        vi.stubEnv(
            "NEXTAUTH_URL",
            "https://NOTEBOOK.example.com:443/notebook/api/auth",
        );
        expect(() => assertSameOrigin(proxied())).not.toThrow();
    });
    it("does not add the internal request origin to the canonical allowlist", () => {
        vi.stubEnv("NEXTAUTH_URL", canonical);
        expect(() =>
            assertSameOrigin(proxied({ Origin: "http://ai-service:3000" })),
        ).toThrow(expect.objectContaining({ status: 403 }));
    });
    it("does not accept canonical hostname with a different scheme or port", () => {
        vi.stubEnv("NEXTAUTH_URL", canonical);
        for (const origin of [
            "http://notebook.example.com",
            "https://notebook.example.com:444",
        ]) {
            expect(() => assertSameOrigin(proxied({ Origin: origin }))).toThrow(
                expect.objectContaining({ status: 403 }),
            );
        }
    });
    it.each<Record<string, string>>([
        {
            Origin: "https://foreign.example.com",
            "X-Forwarded-Host": "foreign.example.com",
            "X-Forwarded-Proto": "https",
        },
        {
            Origin: "https://foreign.example.com",
            Forwarded: "for=192.0.2.1;host=foreign.example.com;proto=https",
        },
        { Origin: "https://foreign.example.com", Host: "foreign.example.com" },
        { Origin: "null", "X-Forwarded-Host": "notebook.example.com" },
    ])(
        "rejects foreign/opaque Origin despite forged proxy headers: %j",
        (headers) => {
            vi.stubEnv("NEXTAUTH_URL", canonical);
            expect(() => assertSameOrigin(proxied(headers))).toThrow(
                expect.objectContaining({ status: 403 }),
            );
        },
    );
    it("ignores proxy headers instead of letting them replace a valid canonical origin", () => {
        vi.stubEnv("NEXTAUTH_URL", canonical);
        expect(() =>
            assertSameOrigin(
                proxied({
                    Host: "foreign.example.com",
                    "X-Forwarded-Host": "foreign.example.com",
                    "X-Forwarded-Proto": "http",
                    Forwarded: "host=foreign.example.com;proto=http",
                }),
            ),
        ).not.toThrow();
    });
    it.each(["cross-site", "same-site", "invalid"])(
        "still rejects %s fetch metadata with the canonical Origin",
        (site) => {
            vi.stubEnv("NEXTAUTH_URL", canonical);
            expect(() =>
                assertSameOrigin(proxied({ "Sec-Fetch-Site": site })),
            ).toThrow(expect.objectContaining({ status: 403 }));
        },
    );
    it("keeps non-browser requests without Origin valid under a canonical deployment", () => {
        vi.stubEnv("NEXTAUTH_URL", canonical);
        expect(() =>
            assertSameOrigin(
                new Request(internal, {
                    headers: { "Sec-Fetch-Site": "none" },
                }),
            ),
        ).not.toThrow();
    });
    it.each([undefined, ""])(
        "falls back to req.url only when NEXTAUTH_URL is absent/empty (%s)",
        (configured) => {
            vi.stubEnv("NEXTAUTH_URL", configured);
            expect(() =>
                assertSameOrigin(proxied({ Origin: "http://ai-service:3000" })),
            ).not.toThrow();
            expect(() => assertSameOrigin(proxied())).toThrow(
                expect.objectContaining({ status: 403 }),
            );
        },
    );
    it("does not use forwarded headers to enable an otherwise foreign fallback origin", () => {
        const req = proxied({
            "X-Forwarded-Host": "notebook.example.com",
            "X-Forwarded-Proto": "https",
            Forwarded: "host=notebook.example.com;proto=https",
        });
        expect(() => assertSameOrigin(req)).toThrow(
            expect.objectContaining({ status: 403 }),
        );
    });
    it.each([
        "not-a-url",
        "//notebook.example.com",
        "ftp://notebook.example.com",
        "data:text/plain,fixture",
        "https://fixture-user:fixture-password@notebook.example.com",
    ])(
        "fails safely rather than falling back for invalid canonical configuration (%s)",
        (configured) => {
            vi.stubEnv("NEXTAUTH_URL", configured);
            const check = () =>
                assertSameOrigin(proxied({ Origin: "http://ai-service:3000" }));
            expect(check).toThrow(
                expect.objectContaining({
                    status: 503,
                    message: "Origin configuration unavailable",
                }),
            );
            expect(check).not.toThrow(configured);
        },
    );
});
