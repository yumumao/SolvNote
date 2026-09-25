// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch as undiciFetch } from "undici";
import { describe, expect, it } from "vitest";
import { pinnedProxyRequest } from "@/lib/ai-local-proxy";

// Real undici/HTTP CONNECT, but the synthetic loopback proxy NEVER opens an upstream socket.
describe("numeric CONNECT on the real proxy transport", () => {
    it.each([
        ["https://api.example.com/v1", "8.8.8.8", "8.8.8.8:443"],
        ["https://api.example.com:8443/v1", "2606:4700:4700::1111", "[2606:4700:4700::1111]:8443"],
    ])("pins the wire destination for %s", async (endpoint, address, expected) => {
        const requests: { path?: string; host?: string; auth?: string; proxyAuth?: string }[] = [];
        const server = createServer();
        server.on("connect", (req, socket) => {
            requests.push({ path: req.url, host: req.headers.host, auth: req.headers.authorization, proxyAuth: req.headers["proxy-authorization"] as string | undefined });
            socket.on("error", () => {});
            socket.end("HTTP/1.1 502 Fixture no-upstream\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as AddressInfo).port;
        const { target, agent } = pinnedProxyRequest(`http://127.0.0.1:${port}`, new URL(endpoint), address);
        try {
            expect(target.href).toBe(endpoint); // fetch must retain the domain to preserve HTTP Host.
            await expect(undiciFetch(target, { dispatcher: agent, redirect: "error", headers: { authorization: "Bearer fixture-not-a-real-key" }, signal: AbortSignal.timeout(2000) })).rejects.toThrow();
            expect(requests).toEqual([{ path: expected, host: expected, auth: undefined, proxyAuth: undefined }]);
        } finally {
            await agent.destroy();
            await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
        }
    });
});
