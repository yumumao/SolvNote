import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";
vi.mock("@/lib/user-management/live-session",()=>({getLiveUser:async(id:string)=>({id,role:id.includes("admin")?"admin":"user",isActive:true,sessionVersion:0,mustChangePassword:false}),isSessionCurrent:()=>true}));

const canonical = "https://notebook.example.com";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXTAUTH_URL", canonical); });
afterEach(() => vi.unstubAllEnvs());

describe("canonical notebook redirects", () => {
    it.each(["/login", "/register"])("keeps authenticated %s on the canonical origin, not Next's internal host", async (path) => {
        vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", sub: "synthetic-admin", role: "admin" });
        const response = await middleware(new NextRequest("http://localhost:3000" + path));
        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe(canonical + "/");
    });
    it("uses the same local canonical origin that protects AI imports", async () => {
        vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:4317");
        vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", sub: "synthetic-admin", role: "admin" });
        const response = await middleware(new NextRequest("http://localhost:4317/login"));
        expect(response?.headers.get("location")).toBe("http://127.0.0.1:4317/");
    });
    it("redirects a signed-out visitor to canonical login and preserves only a relative callback", async () => {
        vi.mocked(getToken).mockResolvedValue(null);
        const response = await middleware(new NextRequest("http://ai-service:3000/admin/ai?tab=import"));
        const target = new URL(response!.headers.get("location")!);
        expect(target.origin).toBe(canonical);
        expect(target.pathname).toBe("/login");
        expect(target.searchParams.get("callbackUrl")).toBe("/admin/ai?tab=import");
    });
    it("keeps the member's admin denial on the canonical origin", async () => {
        vi.mocked(getToken).mockResolvedValue({ id: "synthetic-member", sub: "synthetic-member", role: "user" });
        const response = await middleware(new NextRequest("http://ai-service:3000/admin/ai"));
        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe(canonical + "/");
    });
    it("never derives a canonical redirect from forwarded or Host headers", async () => {
        vi.mocked(getToken).mockResolvedValue(null);
        const response = await middleware(new NextRequest("http://ai-service:3000/admin/ai", { headers: {
            Host: "foreign.example", "X-Forwarded-Host": "foreign.example", "X-Forwarded-Proto": "http",
            Forwarded: "host=foreign.example;proto=http",
        } }));
        expect(new URL(response!.headers.get("location")!).origin).toBe(canonical);
    });
    it("takes only the origin of NEXTAUTH_URL, consistent with the write guard", async () => {
        vi.stubEnv("NEXTAUTH_URL", "https://NOTEBOOK.example.com:443/api/auth");
        vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", role: "admin" });
        const response = await middleware(new NextRequest("http://ai-service:3000/login"));
        expect(response?.headers.get("location")).toBe(canonical + "/");
    });
    it.each([undefined, ""])("retains the existing request-URL fallback when no canonical URL is configured (%s)", async (value) => {
        vi.stubEnv("NEXTAUTH_URL", value);
        vi.mocked(getToken).mockResolvedValue(null);
        const response = await middleware(new NextRequest("http://localhost:3000/admin/ai"));
        expect(new URL(response!.headers.get("location")!).origin).toBe("http://localhost:3000");
    });
    it.each(["not-a-url", "//foreign.example", "ftp://foreign.example", "https://synthetic-user:synthetic-secret@notebook.example.com"])("fails closed for an invalid canonical URL without echoing its value (%s)", async (value) => {
        vi.stubEnv("NEXTAUTH_URL", value);
        vi.mocked(getToken).mockResolvedValue(null);
        const response = await middleware(new NextRequest("http://localhost:3000/admin/ai"));
        expect(response?.status).toBe(503);
        expect(response?.headers.get("location")).toBeNull();
        expect(await response!.text()).toBe("Site URL configuration unavailable");
    });
    it("does not change an authenticated admin's page or redirect an unauthenticated login", async () => {
        vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", role: "admin" });
        expect(await middleware(new NextRequest(canonical + "/admin/ai"))).toBeNull();
        vi.mocked(getToken).mockResolvedValue(null);
        expect(await middleware(new NextRequest(canonical + "/login"))).toBeNull();
    });
});

it.each(["/login", "/admin/ai", "/"])("redirects a local browser alias before authentication at %s", async (path) => {
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:4317");
    vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", role: "admin" });
    const response = await middleware(new NextRequest("http://localhost:4317" + path, { headers: { Host: "localhost:4317" } }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("location")).toBeNull();
    expect(response?.headers.get("refresh")).toBe("0;url=http://127.0.0.1:4317" + path);
});
it("does not loop when Next normalizes the URL but the browser Host is already canonical", async () => {
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:4317");
    vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", role: "admin" });
    const response = await middleware(new NextRequest("http://localhost:4317/admin/ai", { headers: { Host: "127.0.0.1:4317" } }));
    expect(response).toBeNull();
});
it("never rewrites POSTs or mistakes production proxy hosts for local aliases", async () => {
    vi.mocked(getToken).mockResolvedValue({ id: "synthetic-admin", role: "admin" });
    expect(await middleware(new NextRequest("http://localhost:3000/admin/ai", { headers: { Host: "localhost:3000" } }))).toBeNull();
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:4317");
    expect(await middleware(new NextRequest("http://localhost:4317/admin/ai", { method: "POST", headers: { Host: "localhost:4317" } }))).toBeNull();
});

it("keeps local-alias navigation pinned to canonical even for protocol-relative paths and HTML-like queries", async () => {
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:4317");
    const req = new NextRequest("http://localhost:4317//foreign.example/admin?next=%22%3Cscript%3E&tab=import", { headers: { Host: "localhost:4317" } });
    const response = await middleware(req);
    const refresh = response!.headers.get("refresh")!;
    const target = new URL(refresh.slice("0;url=".length));
    expect(target.origin).toBe("http://127.0.0.1:4317");
    expect(target.pathname).toBe("//foreign.example/admin");
    expect(response!.headers.get("cache-control")).toBe("no-store");
    const html = await response!.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;tab=import");
});
