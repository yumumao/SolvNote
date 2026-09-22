// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    lookup: vi.fn(),
    fetch: vi.fn(),
    agent: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({
    fetch: mocks.fetch,
    Agent: class {
        constructor(options: unknown) {
            mocks.agent(options);
        }
        close = mocks.close;
        destroy = mocks.destroy;
    },
}));
import { safeAIFetch, validateAIUrl } from "@/lib/ai-url";
beforeEach(() => {
    vi.resetAllMocks();
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.fetch.mockResolvedValue(Response.json({ ok: true }));
    mocks.close.mockResolvedValue(undefined);
    mocks.destroy.mockResolvedValue(undefined);
});
describe("public AI URL validation and DNS-bound transport", () => {
    it.each([
        "http://api.example.com",
        "file:///etc/passwd",
        "ftp://api.example.com",
        "https://user:pass@api.example.com",
        "https://api.example.com/#secret",
        "https://localhost",
        "https://LOCALHOST.",
        "https://host.local",
        "https://host.internal",
        "https://metadata",
        "https://127.0.0.1",
        "https://127.1",
        "https://2130706433",
        "https://0x7f000001",
        "https://10.0.0.1",
        "https://172.16.1.1",
        "https://192.168.0.1",
        "https://169.254.169.254",
        "https://100.100.100.200",
        "https://0.0.0.0",
        "https://224.0.0.1",
        "https://198.18.0.1",
        "https://168.63.129.16",
        "https://192.0.2.1",
        "https://[::1]",
        "https://[::]",
        "https://[::ffff:127.0.0.1]",
        "https://[fc00::1]",
        "https://[fe80::1]",
        "https://[64:ff9b::a00:1]",
        "https://[2002:7f00:1::]",
        "https://[2001:db8::1]",
    ])("rejects unsafe target %s before connecting", async (url) => {
        await expect(safeAIFetch(url, {})).rejects.toMatchObject({
            status: 400,
        });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each([
        { records: [{ address: "127.0.0.1", family: 4 }] },
        {
            records: [
                { address: "8.8.8.8", family: 4 },
                { address: "10.0.0.1", family: 4 },
            ],
        },
        { records: [{ address: "::ffff:10.0.0.1", family: 6 }] },
        { records: [] },
    ])("rejects private or mixed DNS records case %#", async ({ records }) => {
        mocks.lookup.mockResolvedValue(records);
        await expect(
            safeAIFetch("https://api.example.com/v1", {}),
        ).rejects.toMatchObject({ status: 400 });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("returns a normalized public URL", async () => {
        expect((await validateAIUrl("https://API.EXAMPLE.COM/v1")).href).toBe(
            "https://api.example.com/v1",
        );
        expect(mocks.lookup).toHaveBeenCalledWith("api.example.com", {
            all: true,
            verbatim: true,
        });
    });
    it("permits public IPv4 and IPv6 literals without DNS", async () => {
        expect((await validateAIUrl("https://8.8.8.8")).hostname).toBe(
            "8.8.8.8",
        );
        expect(
            (await validateAIUrl("https://[2606:4700:4700::1111]")).hostname,
        ).toBe("[2606:4700:4700::1111]");
        expect(mocks.lookup).not.toHaveBeenCalled();
    });
    it("pins the validated DNS results for the actual connection and does not re-resolve", async () => {
        mocks.lookup
            .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
            .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
        const response = await safeAIFetch("https://api.example.com/v1", {
            method: "POST",
            body: "{}",
            headers: { authorization: "Bearer fixture-key" },
        });
        expect(await response.json()).toEqual({ ok: true });
        const lookup = mocks.agent.mock.calls[0][0].connect.lookup;
        const callback = vi.fn();
        lookup("api.example.com", {}, callback);
        expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
        const allCallback = vi.fn();
        lookup("api.example.com", { all: true }, allCallback);
        expect(allCallback).toHaveBeenCalledWith(null, [
            { address: "8.8.8.8", family: 4 },
        ]);
        expect(mocks.lookup).toHaveBeenCalledTimes(1);
        expect(mocks.fetch.mock.calls[0][1]).toMatchObject({
            redirect: "error",
            method: "POST",
        });
        expect(mocks.close).toHaveBeenCalledTimes(1);
    });
    it("cannot be downgraded to unguarded dispatch or redirect following", async () => {
        await safeAIFetch("https://api.example.com", {
            redirect: "follow",
            dispatcher: "unsafe",
        } as RequestInit);
        expect(mocks.fetch.mock.calls[0][1].redirect).toBe("error");
        expect(mocks.fetch.mock.calls[0][1].dispatcher).not.toBe("unsafe");
    });
    it("rejects redirects even if the transport returns one", async () => {
        mocks.fetch.mockResolvedValue(
            new Response(null, {
                status: 302,
                headers: { Location: "http://127.0.0.1/private" },
            }),
        );
        await expect(
            safeAIFetch("https://api.example.com", {}),
        ).rejects.toMatchObject({ status: 502 });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
    it("caps actual response bytes rather than trusting Content-Length", async () => {
        mocks.fetch.mockResolvedValue(
            new Response("x".repeat(2 * 1024 * 1024 + 1), {
                headers: { "Content-Length": "1" },
            }),
        );
        await expect(
            safeAIFetch("https://api.example.com", {}),
        ).rejects.toMatchObject({ status: 502 });
    });
    it("sanitizes transport failures and disposes of the dispatcher", async () => {
        mocks.fetch.mockRejectedValue(
            new Error("fixture-secret transport error"),
        );
        const error = await safeAIFetch("https://api.example.com", {}).catch(
            (error: Error) => error,
        );
        expect(error).toMatchObject({ status: 502 });
        expect(String(error)).not.toContain("fixture-secret");
        expect(mocks.destroy).toHaveBeenCalled();
    });
    it("sanitizes DNS failures", async () => {
        mocks.lookup.mockRejectedValue(new Error("fixture-private-host"));
        const error = await validateAIUrl("https://api.example.com").catch(
            (error: Error) => error,
        );
        expect(error).toMatchObject({ status: 400 });
        expect(String(error)).not.toContain("fixture-");
    });
});

describe("shared worker query and cooldown contract", () => {
    it("accepts a fixed Azure api-version query", async () => {
        const url =
            "https://azure.example.com/openai/deployments/demo/chat/completions?api-version=2024-10-21";
        expect((await validateAIUrl(url)).href).toBe(url);
    });
    it("accepts a fixed preview API version", async () => {
        expect(
            (
                await validateAIUrl(
                    "https://azure.example.com/openai/deployments/demo/chat/completions?api-version=2024-02-15-preview",
                )
            ).search,
        ).toBe("?api-version=2024-02-15-preview");
    });
    it("accepts model listing endpoints without URL credentials", async () => {
        const response = await safeAIFetch(
            "https://api.example.com/v1/models",
            { method: "GET" },
        );
        expect(response.status).toBe(200);
    });
    it.each([
        "key=fixture-secret",
        "apiKey=fixture-secret",
        "api_key=fixture-secret",
        "access_token=fixture-secret",
        "api-version=fixture-secret",
        "api-version=2024-10-21&api-version=2024-10-21",
        "api-version=2024-10-21&key=fixture-secret",
    ])("rejects non-version/duplicate query fields: %s", async (query) => {
        await expect(
            safeAIFetch(`https://api.example.com/v1?${query}`, {}),
        ).rejects.toMatchObject({ status: 400 });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("preserves a valid Retry-After cooldown without forwarding arbitrary headers", async () => {
        mocks.fetch.mockResolvedValue(
            new Response("{}", {
                status: 429,
                headers: {
                    "Retry-After": "120",
                    "Set-Cookie": "fixture-cookie",
                    "X-Upstream-Secret": "fixture-secret",
                },
            }),
        );
        const response = await safeAIFetch("https://api.example.com", {});
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("120");
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("x-upstream-secret")).toBeNull();
    });
    it("normalizes a valid HTTP-date cooldown to bounded delta seconds", async () => {
        vi.spyOn(Date, "now").mockReturnValue(
            Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"),
        );
        mocks.fetch.mockResolvedValue(
            new Response("{}", {
                status: 429,
                headers: { "Retry-After": "Wed, 21 Oct 2015 07:30:00 GMT" },
            }),
        );
        const response = await safeAIFetch("https://api.example.com", {});
        expect(response.headers.get("retry-after")).toBe("120");
    });
    it("bounds very long numeric cooldowns", async () => {
        mocks.fetch.mockResolvedValue(
            new Response("{}", {
                status: 429,
                headers: { "Retry-After": "9999999999" },
            }),
        );
        expect(
            (await safeAIFetch("https://api.example.com", {})).headers.get(
                "retry-after",
            ),
        ).toBe("86400");
    });
    it.each(["fixture-secret", "-5", "1.5", "NaN", "x".repeat(200)])(
        "drops malformed Retry-After case %#",
        async (value) => {
            mocks.fetch.mockResolvedValue(
                new Response("{}", {
                    status: 429,
                    headers: { "Retry-After": value },
                }),
            );
            expect(
                (await safeAIFetch("https://api.example.com", {})).headers.get(
                    "retry-after",
                ),
            ).toBeNull();
        },
    );
});
