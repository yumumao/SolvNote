import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/logger";
import { canonicalSiteOrigin } from "@/lib/site-origin";

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
    // Debug logging for middleware
    logger.debug({ method: req.method, path: req.nextUrl.pathname }, 'Processing request');

    try {
        const token = await getToken({
            req,
            secret: process.env.NEXTAUTH_SECRET,
            cookieName: "next-auth.session-token", // Explicitly look for the standardized cookie
        });

        const isAuth = !!token;
        const isAuthPage = req.nextUrl.pathname.startsWith("/login") || req.nextUrl.pathname.startsWith("/register");
        const isAdminPage = req.nextUrl.pathname.startsWith("/admin");

        logger.debug({
            path: req.nextUrl.pathname,
            isAuth,
            isAuthPage,
            hasToken: !!token,
            cookies: req.cookies.getAll().map(c => c.name)
        }, 'Auth status');

        if (isAuthPage) {
            if (isAuth) {
                logger.debug('Redirecting authenticated user to /');
                return redirectToSite("/", req);
            }
            return null;
        }

        if (!isAuth) {
            let from = req.nextUrl.pathname;
            if (req.nextUrl.search) {
                from += req.nextUrl.search;
            }

            logger.debug({ callbackUrl: from }, 'Redirecting unauthenticated user to login');
            return redirectToSite(`/login?callbackUrl=${encodeURIComponent(from)}`, req);
        }

        // Admin route protection: only allow users with admin role
        if (isAdminPage && token?.role !== "admin") {
            logger.warn({ userId: token?.id, path: req.nextUrl.pathname }, 'Non-admin user attempting to access admin area');
            return redirectToSite("/", req);
        }
    } catch (e) {
        logger.error({ error: e }, 'Error processing token');
        return NextResponse.next();
    }
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        "/((?!api|_next/static|_next/image|favicon.ico).*)",
    ],
};
