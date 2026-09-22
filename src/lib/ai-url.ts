import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import {
    Agent,
    fetch as undiciFetch,
    type RequestInit as UndiciRequestInit,
} from "undici";

type Address = { address: string; family: number };

/** Fixed safe errors; no hostname, credential, upstream body, or error cause is retained. */
export class AIUrlError extends Error {
    readonly status = 400;
    constructor() {
        super("AI endpoint must use a public HTTPS address");
        this.name = "AIUrlError";
    }
}
export class AITransportError extends Error {
    readonly status = 502;
    constructor() {
        super("AI provider request failed");
        this.name = "AITransportError";
    }
}

const blocked = new BlockList();
for (const [network, bits] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const)
    blocked.addSubnet(network, bits, "ipv4");
blocked.addAddress("168.63.129.16", "ipv4"); // Azure platform virtual IP.
for (const [network, bits] of [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
] as const) {
    blocked.addSubnet(network, bits, "ipv6");
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return !blocked.check(address, "ipv4");
    // Reject mapped IPv4, NAT64, ULA, link-local, multicast and transition ranges.
    return (
        family === 6 &&
        globalIPv6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6")
    );
}

async function vettedTarget(
    input: string,
): Promise<{ url: URL; addresses: Address[] }> {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new AIUrlError();
    }
    if (
        input.length > 4096 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash
    )
        throw new AIUrlError();
    // Credentials belong in headers. The sole query exception is Azure's fixed API version.
    const query = Array.from(url.searchParams.entries());
    if (
        query.length &&
        (query.length !== 1 ||
            query[0][0] !== "api-version" ||
            !/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(query[0][1]))
    )
        throw new AIUrlError();
    const hostname = url.hostname
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "")
        .toLowerCase();
    const family = isIP(hostname);
    if (family) {
        if (!isPublicAddress(hostname)) throw new AIUrlError();
        return { url, addresses: [{ address: hostname, family }] };
    }
    if (
        !hostname.includes(".") ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|onion)$/.test(
            hostname,
        )
    )
        throw new AIUrlError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const records = await Promise.race([
            lookup(hostname, { all: true, verbatim: true }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new AIUrlError()), 5000);
                timer.unref?.();
            }),
        ]);
        if (
            !records.length ||
            records.some(
                (record) =>
                    isIP(record.address) !== record.family ||
                    !isPublicAddress(record.address),
            )
        )
            throw new AIUrlError();
        return {
            url,
            addresses: records.map(({ address, family }) => ({
                address,
                family,
            })),
        };
    } catch {
        throw new AIUrlError();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Normalize the only forwarded provider control header to at most one day. */
function boundedRetryAfter(value: string | null): string | undefined {
    if (!value || value.length > 128) return undefined;
    const trimmed = value.trim();
    let seconds: number;
    if (/^\d{1,10}$/.test(trimmed)) seconds = Number(trimmed);
    else if (
        /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
            trimmed,
        )
    ) {
        seconds = Math.ceil((Date.parse(trimmed) - Date.now()) / 1000);
    } else return undefined;
    return Number.isFinite(seconds)
        ? String(Math.min(86400, Math.max(0, seconds)))
        : undefined;
}
/** Validation only. Use safeAIFetch for actual traffic; an independent fetch reintroduces a DNS race. */
export async function validateAIUrl(url: string): Promise<URL> {
    return (await vettedTarget(url)).url;
}

/**
 * Shared transport contract for routes and job workers. HTTPS/public IPs only.
 * Every request uses its own DNS-pinned dispatcher, rejects redirects, and buffers
 * at most 2 MiB. The 180s deadline covers connection + body; callers can shorten
 * it with init.signal. Streaming responses and environment proxies are not used.
 */
export async function safeAIFetch(
    input: string,
    init: RequestInit,
): Promise<Response> {
    const { url, addresses } = await vettedTarget(input);
    const agent = new Agent({
        connect: {
            timeout: 10000,
            lookup(_hostname, options, callback) {
                const matches = addresses.filter(
                    (address) =>
                        !options.family || options.family === address.family,
                );
                if (!matches.length) {
                    callback(new AITransportError(), "", 4);
                    return;
                }
                // No DNS is performed here: rebinding cannot replace the checked addresses.
                if (options.all) callback(null, matches);
                else callback(null, matches[0].address, matches[0].family);
            },
        },
    });
    let succeeded = false;
    try {
        const headers = new Headers(init.headers);
        if (headers.has("host") || headers.has("connection"))
            throw new AITransportError();
        const deadline = AbortSignal.timeout(180000);
        const signal = init.signal
            ? AbortSignal.any([init.signal, deadline])
            : deadline;
        const response = await undiciFetch(url, {
            method: init.method,
            headers: Array.from(headers.entries()),
            body: init.body as UndiciRequestInit["body"],
            signal,
            redirect: "error",
            dispatcher: agent,
        });
        if (response.status >= 300 && response.status < 400)
            throw new AITransportError();
        const limit = 2 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > limit)
            throw new AITransportError();
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > limit) {
                        void reader.cancel().catch(() => {});
                        throw new AITransportError();
                    }
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const body =
            [204, 205, 304].includes(response.status) ||
            init.method?.toUpperCase() === "HEAD"
                ? null
                : bytes;
        // Do not forward cookies or raw statusText from a provider.
        const responseHeaders = new Headers({
            "Content-Type":
                response.headers.get("content-type") || "application/json",
        });
        const retryAfter = boundedRetryAfter(
            response.headers.get("retry-after"),
        );
        if (retryAfter !== undefined)
            responseHeaders.set("Retry-After", retryAfter);
        const result = new Response(body, {
            status: response.status,
            headers: responseHeaders,
        });
        succeeded = true;
        return result;
    } catch {
        throw new AITransportError();
    } finally {
        try {
            if (succeeded) await agent.close();
            else await agent.destroy();
        } catch {
            /* Never expose dispatcher errors. */
        }
    }
}
