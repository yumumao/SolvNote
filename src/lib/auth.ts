import { NextAuthOptions } from "next-auth"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { authenticateCredentials } from "@/lib/user-management/authenticate"
import { getLiveUser, isSessionCurrent } from "@/lib/user-management/live-session"
import { createLogger } from "@/lib/logger"

const logger = createLogger('auth');

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
    session: {
        strategy: "jwt",
    },
    // @ts-expect-error trustHost is a valid option in newer NextAuth versions but types might be lagging
    trustHost: true,
    pages: {
        signIn: "/login",
    },
    // Force using a single cookie name to avoid HTTP/HTTPS mismatches in proxy environments
    // Turnstile and same-origin validation still require the canonical NEXTAUTH_URL.
    cookies: {
        sessionToken: {
            name: "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                // Only use secure cookies if explicitly running on HTTPS (via NEXTAUTH_URL)
                // HTTP is only for explicit local testing; public deployments must use HTTPS.
                secure: process.env.NODE_ENV === "production" && process.env.NEXTAUTH_URL?.startsWith("https"),
            },
        },
    },
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                turnstileToken: { label: "Verification", type: "text" }
            },
            async authorize(credentials, req) {
                const headers = new Headers();
                for (const [key, value] of Object.entries(req?.headers ?? {})) {
                    if (typeof value === "string") headers.set(key, value);
                }
                return authenticateCredentials(credentials, headers);
            }
        })
    ],
    // Keep authentication debug output disabled in production and development
    debug: false,
    logger: {
        error(code) {
            logger.error({ code }, 'NextAuth error');
        },
        warn(code) {
            logger.warn({ code }, 'NextAuth warning');
        },
        debug(code) {
            logger.debug({ code }, 'NextAuth debug');
        }
    },
    callbacks: {
        async session({ session, token }) {
            // An invalid token must produce a genuinely absent user, never a truthy empty object.
            if (token.invalidSession || !token.id) {
                return { ...session, user: undefined as unknown as typeof session.user };
            }
            return { ...session, user: { ...session.user, id: token.id, role: token.role,
                sessionVersion: token.sessionVersion ?? 0, mustChangePassword: token.mustChangePassword === true } };
        },
        async jwt({ token, user }) {
            if (user) {
                return { ...token, id: user.id, role: user.role, sessionVersion: user.sessionVersion ?? 0,
                    mustChangePassword: user.mustChangePassword === true, invalidSession: false };
            }
            try {
                const current = typeof token.id === "string" ? await getLiveUser(token.id) : null;
                if (!current || !isSessionCurrent(current, token)) return { ...token, invalidSession: true };
                return { ...token, role: current.role, mustChangePassword: current.mustChangePassword,
                    sessionVersion: current.sessionVersion, invalidSession: false };
            } catch { return { ...token, invalidSession: true }; }
        }
    }
}

// Log startup check
logger.info({
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    HAS_SECRET: !!process.env.NEXTAUTH_SECRET,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST
}, 'AuthConfig loading');
