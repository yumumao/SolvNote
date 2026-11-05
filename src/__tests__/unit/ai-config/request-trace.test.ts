// @vitest-environment node
import { channel } from "node:diagnostics_channel";
import { describe, expect, it, vi } from "vitest";
import { traceAIRequest } from "@/lib/ai-request-trace";

describe("request-scoped transport observers", () => {
    const create = channel("undici:request:create");
    const sent = channel("undici:request:bodySent");
    const headers = channel("undici:client:sendHeaders");
    it("isolates overlapping calls and ignores CONNECT and unrelated traffic", async () => {
        let release!: () => void;
        const ready = new Promise<void>(resolve => { release = resolve; });
        const a = vi.fn(), b = vi.fn();
        const first = { method: "POST" }, second = { method: "POST" }, proxy = { method: "CONNECT" };
        const one = traceAIRequest(async () => {
            create.publish({ request: first });
            create.publish({ request: proxy }); headers.publish({ request: proxy }); sent.publish({ request: proxy });
            await ready;
            sent.publish({ request: first });
        }, a);
        await traceAIRequest(async () => {
            create.publish({ request: second }); headers.publish({ request: second }); sent.publish({ request: second });
        }, b);
        create.publish({ request: { method: "POST" } });
        release(); await one;
        expect(a.mock.calls).toEqual([["requestCreated"], ["requestSent"]]);
        expect(b.mock.calls).toEqual([["requestCreated"], ["requestHeaders"], ["requestSent"]]);
        sent.publish({ request: first }); headers.publish({ request: second });
        expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(3);
    });
    it("never reads sensitive event fields and observer failures do not change the result", async () => {
        const request = { method: "POST", get headers() { throw Error("MUST_NOT_READ"); }, get body() { throw Error("MUST_NOT_READ"); } };
        await expect(traceAIRequest(async () => {
            create.publish({ request });
            headers.publish({ request, get headers() { throw Error("MUST_NOT_READ"); } });
            sent.publish({ request });
            return "ok";
        }, () => { throw Error("OBSERVER_FAILED"); })).resolves.toBe("ok");
    });
    it("removes listeners on rejection", async () => {
        const observe = vi.fn(), request = { method: "POST" };
        await expect(traceAIRequest(async () => { create.publish({ request }); throw Error("fixture"); }, observe)).rejects.toThrow("fixture");
        sent.publish({ request });
        expect(observe.mock.calls).toEqual([["requestCreated"]]);
    });
});
