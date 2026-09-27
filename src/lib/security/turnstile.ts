/** Server-side only: never import this module into client components. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2_048;

type VerifyOptions = { expectedAction: "login" | "register"; remoteIp?: string };

function hostname(value: string): string | null {
    const normalized = value.toLowerCase();
    // Exact DNS names (including localhost/IPv4), not URLs, ports or wildcards.
    if (normalized.length > 253 || !normalized.split(".").every(label =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return normalized;
}

function configuredHostnames(): string[] {
    const explicit = process.env.SOLVNOTE_TURNSTILE_HOSTNAMES?.trim();
    if (explicit) {
        const hosts = explicit.split(",").map(value => hostname(value.trim()));
        // A malformed explicit configuration must not silently widen the allowlist.
        return hosts.every((host): host is string => host !== null) ? hosts : [];
    }
    try {
        // Only trusted deployment configuration, never a request Host header.
        const url = new URL(process.env.NEXTAUTH_URL || "");
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
        const host = hostname(url.hostname);
        return host ? [host] : [];
    } catch {
        return [];
    }
}

export function getTurnstilePublicConfig(): { turnstileSiteKey: string; turnstileConfigured: boolean } {
    const turnstileSiteKey = process.env.SOLVNOTE_TURNSTILE_SITE_KEY?.trim() || "";
    return {
        turnstileSiteKey,
        turnstileConfigured: Boolean(turnstileSiteKey && process.env.SOLVNOTE_TURNSTILE_SECRET_KEY?.trim() && configuredHostnames().length),
    };
}

export async function verifyTurnstileToken(token: unknown, options: VerifyOptions): Promise<boolean> {
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !token.trim()) return false;
    if (!options || !["login", "register"].includes(options.expectedAction)) return false;
    if (!getTurnstilePublicConfig().turnstileConfigured) return false;

    const allowedHosts = configuredHostnames();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>(resolve => {
        timer = setTimeout(() => {
            controller.abort();
            resolve(false);
        }, VERIFY_TIMEOUT_MS);
    });
    try {
        const verification = (async (): Promise<boolean> => {
            const res = await fetch(SITEVERIFY_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    secret: process.env.SOLVNOTE_TURNSTILE_SECRET_KEY!.trim(),
                    response: token,
                    ...(options.remoteIp ? { remoteip: options.remoteIp } : {}),
                }),
                signal: controller.signal,
                cache: "no-store",
                redirect: "error",
            });
            if (!res.ok) return false;
            const result: unknown = await res.json();
            if (!result || typeof result !== "object") return false;
            const data = result as Record<string, unknown>;
            // Siteverify enforces the 300-second lifetime and single-use token contract.
            return data.success === true && data.action === options.expectedAction
                && typeof data.hostname === "string"
                && allowedHosts.includes(hostname(data.hostname) || "");
        })();
        // Bound both the request AND body read, even if a transport ignores abort.
        return await Promise.race([verification, deadline]);
    } catch {
        // No token/secret/error logging, retries, local success cache or bypass.
        return false;
    } finally {
        clearTimeout(timer);
    }
}
