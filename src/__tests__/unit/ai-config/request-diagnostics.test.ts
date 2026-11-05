// @vitest-environment node
import { describe, expect, it } from "vitest";
import { safeTransportDiagnostics } from "@/lib/ai/diagnostics";

describe("request timing privacy boundary", () => {
    const base = { protocol: "chat", requestedStream: true, receivedBytes: 0, elapsedMs: 180000 };
    it("preserves only bounded send timings and byte counts", () => {
        const timing = { requestBytes: 2048, dnsMs: 12, requestCreatedMs: 13, requestHeadersMs: 20, requestSentMs: 22 };
        expect(safeTransportDiagnostics({ ...base, ...timing, url: "PRIVATE", apiKey: "PRIVATE", headers: "PRIVATE", body: "PRIVATE" }))
            .toEqual({ ...base, ...timing });
    });
    it.each([NaN, Infinity, -1, 1.5, 3600001, "PRIVATE", { secret: "PRIVATE" }])("rejects unsafe phase values %#", value => {
        expect(safeTransportDiagnostics({ ...base, dnsMs: value, requestCreatedMs: value, requestHeadersMs: value, requestSentMs: value }))
            .toEqual(base);
    });
    it.each([-1, 1.5, Infinity, 128 * 1024 * 1024 + 1, "PRIVATE"])("rejects unsafe byte counts %#", requestBytes => {
        expect(safeTransportDiagnostics({ ...base, requestBytes })).toEqual(base);
    });
    it("keeps old saved diagnostics without inventing send evidence", () => {
        expect(safeTransportDiagnostics(base)).toEqual(base);
    });
});
