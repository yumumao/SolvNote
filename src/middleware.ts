import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/logger";
import { canonicalSiteOrigin } from "@/lib/site-origin";
import { getLiveUser, isSessionCurrent } from "@/lib/user-management/live-session";

const logger = createLogger('middleware');

/** Only fixed application paths are passed here; never user-provided redirect URLs. */
function redirectToSite(path: string, req: NextRequest) {
    try {
        return NextResponse.redirect(new URL(path, canonicalSiteOrigin(req.url)));
    } catch {
        return new NextResponse("Site URL configuration unavailable", {
            status: 503,
            headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
        });
    }
}

export async function middleware(req: NextRequest) {
    // Local-only alias correction. Host is used only to select a redirect to an
    // already trusted, configured origin, never to allow API writes or choose a target.
    // Do not canonicalize production proxy Hosts (which may be internal), or POSTs.
    if (req.method === "GET" && process.env.NEXTAUTH_URL) {
        try {
            const canonical = new URL(canonicalSiteOrigin(req.url));
            const alias = canonical.hostname === "127.0.0.1" ? "localhost" :
                canonical.hostname === "localhost" ? "127.0.0.1" : null;
            const aliasHost = alias && alias + (canonical.port ? `:${canonical.port}` : "");
            if (canonical.protocol === "http:" && aliasHost && req.headers.get("host")?.toLowerCase() === aliasHost) {
                const target = new URL(canonical.origin);
                target.pathname = req.nextUrl.pathname;
                target.search = req.nextUrl.search;
                // Next also relativizes Location against its listening host, which
                // makes alias -> canonical redirects loop. A local-only navigation
                // response preserves the absolute target without relaxing API guards.
                const href = target.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
                return new NextResponse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>进入错题本</title><a href="${href}">继续进入错题本正式地址</a></html>`, {
                    status: 200,
                    headers: {
                        Refresh: `0;url=${target.href}`,
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-store",
                        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
                        "Referrer-Policy": "no-referrer",
                    },
                });
            }
        } catch {
            return new NextResponse("Site URL configuration unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        }
    }
    const path = req.nextUrl.pathname;
    const isApi = path.startsWith("/api/");
    const publicPaths = new Set(["/api/register", "/api/register/status", "/api/registration/status",
        "/api/ai/config/template", "/favicon.ico", "/icon.svg", "/apple-icon.png"]);
    if (publicPaths.has(path) || path.startsWith("/api/auth/") || path.startsWith("/icons/"))
        return NextResponse.next();
    try {
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName: "next-auth.session-token" });
        const current = token && typeof token.id === "string" ? await getLiveUser(token.id) : null;
        const user = current && token && isSessionCurrent(current, token) ? current : null;
        const isAuthPage = path === "/login" || path === "/register";
        if (isAuthPage) {
            if (!user) return null;
            return redirectToSite(user.mustChangePassword ? "/change-password" : "/", req);
        }
        if (!user) {
            if (isApi) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
            return redirectToSite(`/login?callbackUrl=${encodeURIComponent(path + req.nextUrl.search)}`, req);
        }
        // A shared boundary also covers legacy cookie-authenticated write routes.
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            const site = req.headers.get("sec-fetch-site");
            const origin = req.headers.get("origin");
            if ((site !== null && site !== "same-origin" && site !== "none") ||
                (origin !== null && origin !== canonicalSiteOrigin(req.url)))
                return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403, headers: { "Cache-Control": "no-store" } });
        }
        if (user.mustChangePassword && path !== "/change-password" && path !== "/api/user/password") {
            if (isApi) return NextResponse.json({ error: "Password change required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
            return redirectToSite("/change-password", req);
        }
        if ((path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) && user.role !== "admin") {
            if (isApi) return NextResponse.json({ error: "Administrator access required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
            return redirectToSite("/", req);
        }
        return null;
    } catch {
        logger.error("Authentication boundary unavailable");
        return NextResponse.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
export const config = {
    runtime: "nodejs",
    matcher: ["/((?!_next/static/).*)"],
};
