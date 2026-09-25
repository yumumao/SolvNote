import { isIP } from "node:net";
import { Client, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

type Address = { address: string; family: number };
const DNS_HOST = "cloudflare-dns.com";
const DNS_IP = "1.1.1.1";
const DNS_LIMIT = 32 * 1024;

/** Server-only opt-in. Never trust imported provider settings or generic proxy env vars. */
export function localAIProxy(): string | undefined {
    const input = process.env.AI_LOCAL_HTTPS_PROXY;
    if (!input) return undefined;
    const url = new URL(input);
    if (
        input.length > 2048 || url.protocol !== "http:" ||
        !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) throw new Error("Invalid local AI proxy configuration");
    return url.origin;
}

/** Caller MUST vet the address first. Numeric CONNECT prevents proxy-side DNS rebinding. */
export function pinnedProxyRequest(proxy: string, original: URL, address: string) {
    const target = new URL(original.href);
    const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${original.port || "443"}`;
    const hostname = original.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const agent = new ProxyAgent({
        uri: proxy,
        clientFactory(origin, options) {
            type ConnectOptions = Omit<Dispatcher.ConnectOptions, "origin">;
            type ConnectCallback = (err: Error | null, data: Dispatcher.ConnectData) => void;
            class PinnedClient extends Client {
                override connect(options: ConnectOptions): Promise<Dispatcher.ConnectData>;
                override connect(options: ConnectOptions, callback: ConnectCallback): void;
                override connect(options: ConnectOptions, callback?: ConnectCallback) {
                    const pinned = { ...options, path: authority, headers: { host: authority } };
                    if (callback) return super.connect(pinned, callback);
                    return super.connect(pinned);
                }
            }
            return new PinnedClient(origin, options);
        },
        requestTls: {
            // Keep TLS identity verification tied to the original domain, not the pinned IP.
            ...(isIP(hostname) ? {} : { servername: hostname }),
            rejectUnauthorized: true,
            timeout: 10000,
        },
        proxyTls: { timeout: 10000 },
    });
    // Keep the original URL: undici.fetch deliberately removes user-supplied Host.
    // Pin only CONNECT, preserving the original HTTP Host and TLS SNI/verification.
    return { target, agent };
}

async function dnsAnswer(hostname: string, type: "A" | "AAAA", proxy: string, signal: AbortSignal): Promise<Address[]> {
    const endpoint = new URL(`https://${DNS_HOST}/dns-query`);
    endpoint.searchParams.set("name", hostname);
    endpoint.searchParams.set("type", type);
    // Bootstrap IP + explicit TLS domain: the system's Fake-IP DNS is never consulted.
    const { target, agent } = pinnedProxyRequest(proxy, endpoint, DNS_IP);
    let cleanup: (() => void) | undefined;
    try {
        const response = await undiciFetch(target, {
            dispatcher: agent, redirect: "error", signal,
            headers: { accept: "application/dns-json" },
        });
        if (response.status !== 200 || Number(response.headers.get("content-length")) > DNS_LIMIT || !response.body)
            throw new Error("DNS unavailable");
        const reader = response.body.getReader();
        cleanup = () => { void reader.cancel().catch(() => {}); reader.releaseLock(); };
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > DNS_LIMIT) throw new Error("DNS response too large");
            chunks.push(value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const code = type === "A" ? 1 : 28;
        if (data.Status !== 0 || data.TC === true || !Array.isArray(data.Question) || data.Question.length !== 1 ||
            typeof data.Question[0]?.name !== "string" || data.Question[0].name.toLowerCase().replace(/\.$/, "") !== hostname ||
            data.Question[0].type !== code || (data.Answer !== undefined && !Array.isArray(data.Answer)))
            throw new Error("DNS answer rejected");
        const addresses: Address[] = [];
        for (const record of data.Answer || []) {
            if (record.type !== 1 && record.type !== 28) continue; // CNAMEs are not followed locally.
            const family = record.type === 1 ? 4 : 6;
            if (typeof record.data !== "string" || isIP(record.data) !== family)
                throw new Error("DNS address rejected");
            addresses.push({ address: record.data, family });
        }
        return addresses;
    } finally {
        try { cleanup?.(); } catch { /* no raw errors escape the URL gate */ }
        try { await agent.destroy(); } catch { /* best-effort cleanup */ }
    }
}

/** Only DNS questions leave here: no API key, image, prompt or provider headers. */
export async function proxyPublicDNS(hostname: string, proxy: string, callerSignal?: AbortSignal): Promise<Address[]> {
    const timeout = AbortSignal.timeout(5000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    signal.throwIfAborted();
    const groups = await Promise.all([
        dnsAnswer(hostname, "A", proxy, signal),
        dnsAnswer(hostname, "AAAA", proxy, signal),
    ]);
    return groups.flat(); // The shared URL gate rejects ANY non-public/mismatched address.
}
