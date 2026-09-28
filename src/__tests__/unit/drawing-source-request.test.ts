// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ callChain: vi.fn(), approved: vi.fn(), runtime: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/ai/chain", () => ({ callChain: mocks.callChain }));
vi.mock("@/lib/ai-jobs/context", () => ({ aiRun: { getStore: mocks.run } }));
vi.mock("@/lib/ai-access/effective-config", () => ({ loadEffectiveAIConfig: vi.fn() }));
vi.mock("@/lib/ai-access/runtime", () => ({ runtimeConfig: mocks.runtime }));
vi.mock("@/lib/ai-drawing/settings", () => ({ approvedImageEditor: mocks.approved }));
vi.mock("@/lib/ai/managed-service", () => ({ dataImage: (image?: string) => image }));
import { executeDrawing } from "@/lib/ai-drawing/service";
import { buildImageEditRequest } from "@/lib/ai-drawing/image-edit";
import { AIError } from "@/lib/ai/transport";
import type { JobInput } from "@/lib/ai-jobs/schema";

const image = "data:image/png;base64,YQ==";
const input: JobInput = { questionText: "Synthetic source", drawingCorrection: "", answerText: "Synthetic answer", analysis: "Rotate a copy, not the source", mimeType: "image/png", language: "zh", mode: "direct", review: false, tags: [], difficulty: "medium", previousErrors: "" };
const plan = { title: "Synthetic base", points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 4, y: 0 }], segments: [], steps: [{ description: "Copy", operation: { kind: "rotate" as const, id: "B1", point: "B", center: "A", degrees: 90 } }] };
const provider = { id: "p", name: "synthetic", protocol: "gemini" as const, baseUrl: "https://example.invalid", apiKey: "synthetic-only", enabled: true };
const model = { id: "v", providerId: "p", name: "synthetic", model: "synthetic", capabilities: ["text", "vision"] as ("text" | "vision")[], enabled: true };
beforeEach(() => { vi.clearAllMocks(); mocks.callChain.mockResolvedValue({...plan,steps:[]}); });

describe("source-aware construction requests", () => {
    it("requires the vision chain when a source image is supplied instead of silently dropping it", async () => {
        await expect(executeDrawing("construction", { ...input, imageBase64: image })).resolves.toEqual({ type: "construction", plan: {...plan,steps:[]} });
        expect(mocks.callChain).toHaveBeenCalledTimes(1);
        expect(mocks.callChain.mock.calls[0][2]).toBe(image);
        expect(mocks.callChain.mock.calls[0][4]).toMatchObject({ role: "recognize", stage: "construction" });
    });
    it("keeps text-only construction available when there is no source image", async () => {
        await executeDrawing("construction", input);
        expect(mocks.callChain.mock.calls[0][2]).toBeUndefined();
        expect(mocks.callChain.mock.calls[0][4]).toMatchObject({ role: "solve", stage: "construction" });
    });
    it("uses the original image ahead of a cropped image without an extra OCR request", async () => {
        await executeDrawing("construction", { ...input, imageBase64: image, originalImageBase64: "data:image/png;base64,Yg==" });
        expect(mocks.callChain).toHaveBeenCalledTimes(1);
        expect(mocks.callChain.mock.calls[0][2]).toBe("data:image/png;base64,Yg==");
        expect(mocks.callChain.mock.calls[0][3]).toBeTypeOf("function");
    });
    it("does not silently fall back to a text-only drawing if no vision model is available", async () => {
        mocks.callChain.mockRejectedValueOnce(new AIError("AI_NO_VISION_MODEL"));
        await expect(executeDrawing("construction", { ...input, imageBase64: image })).rejects.toMatchObject({ code: "AI_NO_VISION_MODEL" });
        expect(mocks.callChain).toHaveBeenCalledTimes(1);
    });
    it("also constrains image editing to keep the source orientation and add rotated copies only", async () => {
        mocks.run.mockReturnValue({}); mocks.runtime.mockResolvedValue({}); mocks.approved.mockResolvedValue({ model, provider });
        mocks.callChain.mockResolvedValue(image);
        await executeDrawing("image_edit", { ...input, imageBase64: image, drawingPlan: plan, drawingRevision: 1, confirmImageEdit: true });
        expect(mocks.callChain.mock.calls[0][0]).toContain("不得整体旋转、镜像或翻转原题底图");
        expect(mocks.callChain.mock.calls[0][0]).toContain("旋转后的副本");
        const req = buildImageEditRequest(provider, model, "synthetic instruction", image);
        expect(JSON.stringify(req.body)).toContain("不得整体旋转、镜像或翻转原题底图");
    });
});
