// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

// Real Undici fetch/HTTP parser and real loopback sockets. Only the connector and
// DNS are replaced; no public network, real provider or production key is used.
const fixture = vi.hoisted(() => ({ port: 0 }));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] }));
vi.mock("undici", async importOriginal => {
    const actual = await importOriginal<typeof import("undici")>();
    const net = await import("node:net");
    return { ...actual, Agent: class extends actual.Agent {
        constructor() {
            super({ connect(_options, callback) {
                const socket = net.connect(fixture.port, "127.0.0.1");
                const failed = (error: Error) => callback(error, null);
                socket.once("error", failed);
                socket.once("connect", () => { socket.off("error", failed); callback(null, socket); });
            } });
        }
    } };
});
import { sendAI } from "@/lib/ai/transport";

const provider = { id: "p", name: "Synthetic", protocol: "chat" as const,
    baseUrl: "https://example.com/v1", apiKey: "SYNTHETIC-LOCAL-ONLY", enabled: true };
const model = { id: "m", providerId: "p", name: "Synthetic", model: "fixture",
    capabilities: ["text", "vision"] as ("text" | "vision")[], enabled: true };
let server: Server;
let requests: number;
let handle: (req: IncomingMessage, res: ServerResponse) => void;
beforeEach(async () => {
    requests = 0;
    handle = () => {};
    server = createServer((req, res) => { requests++; handle(req, res); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Missing fixture port");
    fixture.port = address.port;
});
afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("actual socket lifecycle across the safe transport boundary", () => {
    it.each(["chat", "responses"] as const)("returns %s completion while upstream keeps HTTP open", async protocol => {
        let received = 0;
        handle = (req, res) => {
            req.on("data", chunk => { received += chunk.length; });
            req.on("end", () => {
                res.writeHead(200, { "content-type": "text/event-stream" });
                res.write(protocol === "chat"
                    ? 'data: {"choices":[{"index":0,"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n'
                    : 'data: {"type":"response.completed","response":{"status":"completed","output_text":"complete"}}\n\n');
                // Deliberately no res.end(): this reproduced the September defect.
            });
        };
        const image = "data:image/png;base64," + "A".repeat(1024 * 1024);
        await expect(sendAI({ ...provider, protocol }, model, "synthetic", "synthetic", image, AbortSignal.timeout(2000), [], "transcription")).resolves.toBe("complete");
        expect(received).toBeGreaterThan(1024 * 1024);
        expect(requests).toBe(1);
    });
    it("reproduces zero-byte timeout when the server accepts the upload but sends no headers", async () => {
        let uploaded = false;
        handle = req => { req.resume(); req.on("end", () => { uploaded = true; }); };
        await expect(sendAI(provider, model, "synthetic", "synthetic", undefined, AbortSignal.timeout(500), [], "transcription"))
            .rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN", fallback: false, diagnostic: "TIMEOUT_BEFORE_HEADERS", transport: {
                receivedBytes: 0, requestBytes: expect.any(Number), dnsMs: expect.any(Number),
                requestCreatedMs: expect.any(Number), requestHeadersMs: expect.any(Number), requestSentMs: expect.any(Number),
            } });
        expect(uploaded).toBe(true);
        expect(requests).toBe(1);
    });
    it("distinguishes an empty body after headers from an upload/header stall", async () => {
        handle = (req, res) => {
            req.resume();
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.flushHeaders();
        };
        await expect(sendAI(provider, model, "synthetic", "synthetic", undefined, AbortSignal.timeout(500), [], "transcription"))
            .rejects.toMatchObject({ code: "AI_ACCEPTANCE_UNKNOWN", fallback: false, diagnostic: "TIMEOUT_READING_BODY", transport: { headersMs: expect.any(Number), receivedBytes: 0 } });
        expect(requests).toBe(1);
    });
});
