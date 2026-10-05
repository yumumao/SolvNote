// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, decodeResponse, sendAI } from "@/lib/ai/transport";

// Exercise the real URL gate, but never perform DNS or network I/O.
const network = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
    Client: class { constructor() { throw new Error("Unexpected proxy in direct-mode fixture"); } },
    fetch: network.fetch,
    Agent: class {
        async close() {
            return undefined;
        }
        async destroy() {
            return undefined;
        }
    },
}));

const p = {
    id: "p",
    name: "P",
    protocol: "chat" as const,
    baseUrl: "https://example.com/v1",
    apiKey: "synthetic",
    enabled: true,
};
const m = {
    id: "m",
    providerId: "p",
    model: "unit",
    name: "M",
    enabled: true,
    capabilities: ["text", "vision"] as ("text" | "vision")[],
};

beforeEach(() => {
    vi.resetAllMocks();
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.fetch.mockResolvedValue(
        Response.json({ choices: [{ message: { content: "ok" } }] }),
    );
});

describe("AI wire protocols", () => {
    for (const protocol of [
        "chat",
        "responses",
        "responses_codex",
        "gemini",
        "azure",
    ] as const) {
        it(`keeps image with ${protocol}`, () => {
            const r = buildRequest(
                { ...p, protocol },
                m,
                "instruction",
                "question",
                "data:image/png;base64,YQ==",
            );
            expect(JSON.stringify(r.body)).toContain("YQ==");
            expect(r.url).toMatch(/^https:/);
            expect(JSON.stringify(r.body)).not.toContain("synthetic");
        });
    }

    it("codex uses streaming responses with no store or temperature", () => {
        const r = buildRequest(
            { ...p, protocol: "responses_codex" },
            m,
            "rule",
            "q",
        );
        expect(r.body).toMatchObject({ store: false, stream: true });
        expect(r.body).not.toHaveProperty("temperature");
        expect(r.url).toBe("https://example.com/v1/responses");
    });

    it("reads completed SSE and refuses incomplete streams", async () => {
        const text =
            'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
        expect(
            await decodeResponse(
                new Response(text, {
                    headers: { "Content-Type": "text/event-stream" },
                }),
                "responses",
            ),
        ).toBe("ok");
        await expect(
            decodeResponse(
                new Response(
                    'data: {"type":"response.output_text.delta","delta":"x"}\n\n',
                    {
                        headers: { "Content-Type": "text/event-stream" },
                    },
                ),
                "responses",
            ),
        ).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");
    });
});

// Nonstandard reverse-proxy roots must not gain a second /v1.
it.each([
    ["https://example.com", "https://example.com/v1/responses"],
    ["https://example.com/api/v2", "https://example.com/api/v2/responses"],
    [
        "https://example.com/backend-api/codex/responses",
        "https://example.com/backend-api/codex/responses",
    ],
])("preserves explicit Responses root %s", (baseUrl, expected) => {
    expect(
        buildRequest(
            { ...p, protocol: "responses_codex", baseUrl },
            m,
            "rule",
            "q",
        ).url,
    ).toBe(expected);
});

describe.each([
    { protocol: "chat" as const, endpoint: "/chat/completions" },
    { protocol: "responses" as const, endpoint: "/responses" },
    { protocol: "responses_codex" as const, endpoint: "/responses" },
])("$protocol endpoint resolution", ({ protocol, endpoint }) => {
    it.each([
        [`https://example.com${endpoint}`, `https://example.com${endpoint}`],
        [`https://example.com${endpoint}/`, `https://example.com${endpoint}`],
        [
            `https://example.com/v1${endpoint}`,
            `https://example.com/v1${endpoint}`,
        ],
        [
            `https://example.com/custom/api${endpoint}`,
            `https://example.com/custom/api${endpoint}`,
        ],
    ])("preserves a complete endpoint %s", (baseUrl, expected) => {
        expect(
            buildRequest({ ...p, protocol, baseUrl }, m, "rule", "q").url,
        ).toBe(expected);
    });

    it.each(["https://example.com", "https://example.com/"])(
        "adds /v1 only for the bare root %s",
        (baseUrl) => {
            expect(
                buildRequest({ ...p, protocol, baseUrl }, m, "rule", "q").url,
            ).toBe(`https://example.com/v1${endpoint}`);
        },
    );

    it.each([
        ["https://example.com/v1", `https://example.com/v1${endpoint}`],
        [
            "https://example.com/api/v2/",
            `https://example.com/api/v2${endpoint}`,
        ],
    ])("keeps a custom base prefix %s", (baseUrl, expected) => {
        expect(
            buildRequest({ ...p, protocol, baseUrl }, m, "rule", "q").url,
        ).toBe(expected);
    });
});

it.each(["responses", "responses_codex"] as const)(
    "switches a complete chat endpoint to %s without inventing /v1",
    (protocol) => {
        expect(
            buildRequest(
                {
                    ...p,
                    protocol,
                    baseUrl: "https://example.com/chat/completions",
                },
                m,
                "rule",
                "q",
            ).url,
        ).toBe("https://example.com/responses");
    },
);

describe("sendAI acceptance boundary", () => {
    it("decodes a successful response through the shared transport", async () => {
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).resolves.toBe("ok");
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });

    it("allows fallback after URL rejection before dispatch", async () => {
        await expect(
            sendAI(
                { ...p, baseUrl: "https://127.0.0.1" },
                m,
                "rule",
                "q",
                undefined,
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({
            code: "AI_ENDPOINT_REJECTED",
            fallback: true,
        });
        expect(network.lookup).not.toHaveBeenCalled();
        expect(network.fetch).not.toHaveBeenCalled();
    });

    it("allows fallback after DNS resolves a public hostname to a private address", async () => {
        network.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).rejects.toMatchObject({
            code: "AI_ENDPOINT_REJECTED",
            fallback: true,
        });
        expect(network.fetch).not.toHaveBeenCalled();
    });

    it("allows fallback after DNS failure with no dispatch", async () => {
        network.lookup.mockRejectedValue(new Error("synthetic DNS failure"));
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).rejects.toMatchObject({
            code: "AI_ENDPOINT_REJECTED",
            fallback: true,
        });
        expect(network.fetch).not.toHaveBeenCalled();
    });

    it.each([
        ["network failure", new TypeError("synthetic network failure")],
        ["timeout", new DOMException("synthetic timeout", "TimeoutError")],
        ["abort", new DOMException("synthetic abort", "AbortError")],
        [
            "misleading error name",
            Object.assign(new Error("synthetic failure"), {
                name: "AIUrlError",
            }),
        ],
    ])("never retries an uncertain %s after dispatch", async (_name, error) => {
        network.fetch.mockRejectedValue(error);
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).rejects.toMatchObject({
            code: "AI_ACCEPTANCE_UNKNOWN",
            fallback: false,
        });
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });

    it("never retries a response body interrupted after dispatch", async () => {
        network.fetch.mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(
                            new Error("synthetic body interruption"),
                        );
                    },
                }),
            ),
        );
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).rejects.toMatchObject({
            code: "AI_ACCEPTANCE_UNKNOWN",
            fallback: false,
        });
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });

    it("never retries a guarded transport rejection after dispatch", async () => {
        network.fetch.mockResolvedValue(
            new Response(null, {
                status: 302,
                headers: { Location: "https://other.example.com/" },
            }),
        );
        await expect(
            sendAI(p, m, "rule", "q", undefined, new AbortController().signal),
        ).rejects.toMatchObject({
            code: "AI_ACCEPTANCE_UNKNOWN",
            fallback: false,
        });
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });

    it("never retries an incomplete Responses stream", async () => {
        network.fetch.mockResolvedValue(
            new Response(
                'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
                {
                    headers: { "Content-Type": "text/event-stream" },
                },
            ),
        );
        await expect(
            sendAI(
                { ...p, protocol: "responses" },
                m,
                "rule",
                "q",
                undefined,
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({
            code: "AI_ACCEPTANCE_UNKNOWN",
            fallback: false,
        });
        expect(network.fetch).toHaveBeenCalledTimes(1);
    });
});


describe("safe receive timing for online-only failures",()=>{
 it.each([false,true])("distinguishes headers-only from a partially received body (partial=%s)",async partial=>{
  const controller=new AbortController();const fragment='data: {"choices":[{"index":0,"delta":{"content":"synthetic partial"}}]}\n\n';
  network.fetch.mockResolvedValue(new Response(new ReadableStream({start(c){if(partial)c.enqueue(new TextEncoder().encode(fragment));}}),{headers:{"content-type":"text/event-stream"}}));
  const timer=setTimeout(()=>controller.abort(new DOMException("timeout","TimeoutError")),40);
  try{
   const error=await sendAI(p,m,"private prompt","private input",undefined,controller.signal,[],"transcription").catch(e=>e);
   expect(error).toMatchObject({code:"AI_ACCEPTANCE_UNKNOWN",fallback:false,diagnostic:"TIMEOUT_READING_BODY",transport:{protocol:"chat",requestedStream:true,responseFormat:"sse",headersMs:expect.any(Number),receivedBytes:partial?new TextEncoder().encode(fragment).length:0,elapsedMs:expect.any(Number)}});
   if(partial)expect(error.transport.firstByteMs).toEqual(expect.any(Number));else expect(error.transport).not.toHaveProperty("firstByteMs");
   expect(JSON.stringify(error.transport)).not.toMatch(/private|synthetic|apiKey|baseUrl|example\.com/);expect(network.fetch).toHaveBeenCalledTimes(1);
  }finally{clearTimeout(timer);}
 });
});
