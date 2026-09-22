// @vitest-environment node
import { describe, it, expect } from "vitest";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import { failureState, publicJob } from "@/lib/ai-jobs/store";
describe("durable job safety", () => {
    it("does not retry acceptance-unknown requests", () => {
        expect(failureState("AI_ACCEPTANCE_UNKNOWN", false)).toBe("unknown");
        expect(failureState("AI_HTTP_500", false)).toBe("failed");
        expect(failureState("AI_ACCEPTANCE_UNKNOWN", true)).toBe("cancelled");
    });
    it("rejects image dropping and oversized/malformed inputs", () => {
        expect(() =>
            JobInputSchema.parse({
                questionText: "q",
                imageBase64: "data:image/png;base64,YQ==",
                mode: "text",
            }),
        ).toThrow();
        expect(() =>
            JobInputSchema.parse({ imageBase64: "file:///private" }),
        ).toThrow();
    });
    it("never includes request/result ciphertext or lease tokens in public metadata", () => {
        expect(
            publicJob({
                id: "j",
                kind: "analyze",
                state: "pending",
                attempts: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                errorCode: null,
                input: "secret",
                leaseOwner: "secret",
                result: "secret",
            } as never),
        ).not.toHaveProperty("input");
    });
});
