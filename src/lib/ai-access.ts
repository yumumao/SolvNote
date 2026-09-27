import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getLiveUser, isSessionCurrent } from "@/lib/user-management/live-session";
import { canonicalSiteOrigin } from "@/lib/site-origin";

/** Only pass fixed, public-facing messages to this error. Never pass provider/DB errors. */
export class AIRequestError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "AIRequestError";
    }
}

/** The optional request is reserved for callers; authentication always uses the server session. */
export async function requireUser(
    _req?: Request,
): Promise<{ id: string; role: string; sessionVersion: number }> {
    void _req;
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id || typeof session.user.id !== "string") {
            throw new AIRequestError(401, "Authentication required");
        }
        const user = await getLiveUser(session.user.id);
        if (!user || !isSessionCurrent(user, session.user))
            throw new AIRequestError(403, "Access denied");
        if (user.mustChangePassword) throw new AIRequestError(403, "Password change required");
        return { id: user.id, role: user.role, sessionVersion: user.sessionVersion };
    } catch (error) {
        if (error instanceof AIRequestError) throw error;
        throw new AIRequestError(503, "Authentication temporarily unavailable");
    }
}

export async function requireAdmin(
    req?: Request,
): Promise<{ id: string; role: string; sessionVersion: number }> {
    const user = await requireUser(req);
    if (user.role !== "admin")
        throw new AIRequestError(403, "Administrator access required");
    return user;
}

/** Fail closed for browser cross-origin requests; do not trust forwarded host headers. */
export function assertSameOrigin(req: Request): void {
    const site = req.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") {
        throw new AIRequestError(403, "Cross-origin request denied");
    }
    const origin = req.headers.get("origin");
    if (origin === null) return; // Non-browser clients still require authentication.
    let trustedOrigin: string;
    try {
        // Behind TLS termination req.url may contain only the internal HTTP host.
        // A deployment-provided canonical URL is the sole trusted origin; never
        // derive it from Host, Forwarded, X-Forwarded-Host or X-Forwarded-Proto.
        trustedOrigin = canonicalSiteOrigin(req.url);
    } catch {
        // Misconfigured deployments must not silently fall back or expose the URL.
        throw new AIRequestError(503, "Origin configuration unavailable");
    }
    if (origin !== trustedOrigin)
        throw new AIRequestError(403, "Cross-origin request denied");
}

export function aiJson(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store", Vary: "Cookie" },
    });
}

/** Unknown errors, including their message/stack/cause, never reach responses or logs. */
export function aiErrorResponse(
    error: unknown,
    fallbackStatus = 500,
): NextResponse {
    if (error instanceof AIRequestError)
        return aiJson({ error: error.message }, error.status);
    return aiJson(
        {
            error:
                fallbackStatus === 502
                    ? "AI provider request failed"
                    : "Unable to process request",
        },
        fallbackStatus,
    );
}

/** Bound bytes while reading (Content-Length alone is not a security boundary). */
export async function readAIJson(
    req: Request,
    maxBytes = 64 * 1024,
): Promise<unknown> {
    if (
        req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
    ) {
        throw new AIRequestError(415, "JSON content type required");
    }
    const length = req.headers.get("content-length");
    if (
        length !== null &&
        (!/^\d+$/.test(length) || Number(length) > maxBytes)
    ) {
        throw new AIRequestError(413, "Request body too large");
    }
    const reader = req.body?.getReader();
    if (!reader) throw new AIRequestError(400, "Invalid JSON body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                void reader.cancel().catch(() => {});
                throw new AIRequestError(413, "Request body too large");
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            (key, value: unknown) => {
                if (
                    key === "__proto__" ||
                    key === "prototype" ||
                    key === "constructor"
                ) {
                    throw new AIRequestError(400, "Invalid JSON body");
                }
                return value;
            },
        );
    } catch (error) {
        if (error instanceof AIRequestError) throw error;
        throw new AIRequestError(400, "Invalid JSON body");
    } finally {
        reader.releaseLock();
    }
}

export const MASKED_AI_KEY = "********";
export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
export const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com";

export interface LegacyAIConnection {
    provider: "openai" | "gemini" | "azure";
    apiKey: string;
    baseUrl?: string;
    endpoint?: string;
    model?: string;
    instanceId?: string;
    deploymentName?: string;
}

/** Admin callers only. A mask must never forward a saved secret to a newly supplied endpoint. */
export async function resolveLegacyAIKey(
    input: LegacyAIConnection,
): Promise<string> {
    if (input.apiKey !== MASKED_AI_KEY) return input.apiKey;
    const { getAppConfig } = await import("@/lib/config");
    const config = getAppConfig();
    const normalized = (value: string) => {
        try {
            const url = new URL(value);
            if (url.username || url.password || url.search || url.hash)
                return undefined;
            return url.href.replace(/\/+$/, "");
        } catch {
            return undefined;
        }
    };
    const sameTarget = (left: string, right: string) => {
        const target = normalized(left);
        return target !== undefined && target === normalized(right);
    };
    let key: string | undefined;
    if (input.provider === "openai") {
        const matches = (config.openai?.instances ?? []).filter(
            (instance) =>
                sameTarget(
                    instance.baseUrl || DEFAULT_OPENAI_URL,
                    input.baseUrl || DEFAULT_OPENAI_URL,
                ) &&
                (!input.instanceId || instance.id === input.instanceId) &&
                (!input.model || instance.model === input.model),
        );
        if (matches.length === 1) key = matches[0].apiKey;
    } else if (input.provider === "gemini") {
        if (
            sameTarget(
                config.gemini?.baseUrl || DEFAULT_GEMINI_URL,
                input.baseUrl || DEFAULT_GEMINI_URL,
            )
        )
            key = config.gemini?.apiKey;
    } else if (
        sameTarget(config.azure?.endpoint || "", input.endpoint || "") &&
        config.azure?.deploymentName === input.deploymentName
    ) {
        key = config.azure?.apiKey;
    }
    if (!key || key === MASKED_AI_KEY)
        throw new AIRequestError(
            400,
            "Enter an API key for this configuration",
        );
    return key;
}
