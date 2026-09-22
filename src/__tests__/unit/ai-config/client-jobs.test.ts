import { describe, it, expect, vi, afterEach } from "vitest";
import { apiClient } from "@/lib/api-client";
afterEach(() => vi.unstubAllGlobals());
describe("202 AI jobs", () => {
    it("polls the same job rather than resubmitting", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        jobId: "job1",
                        statusUrl: "/api/ai/jobs/job1",
                    }),
                    { status: 202 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        state: "success",
                        result: { answer: "ok" },
                    }),
                ),
            );
        vi.stubGlobal("fetch", fetchMock);
        expect(
            await apiClient.post("/api/analyze", { questionText: "q" }),
        ).toEqual({ answer: "ok" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("/api/ai/jobs/job1");
    });
    it("does not turn an unknown result into success or resubmit", async () => {
        const mock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        jobId: "job2",
                        statusUrl: "/api/ai/jobs/job2",
                    }),
                    { status: 202 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        state: "unknown",
                        errorCode: "AI_ACCEPTANCE_UNKNOWN",
                    }),
                ),
            );
        vi.stubGlobal("fetch", mock);
        await expect(apiClient.post("/api/analyze", {})).rejects.toMatchObject({
            data: { message: "AI_ACCEPTANCE_UNKNOWN" },
        });
        expect(mock).toHaveBeenCalledTimes(2);
    });
});
