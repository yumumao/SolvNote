import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedQuestion } from "@/lib/ai/types";
vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({
        language: "zh",
        t: { editor: {}, common: {}, errors: {} },
    }),
}));
vi.mock("@/lib/frontend-logger", () => ({
    frontendLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/markdown-renderer", () => ({
    MarkdownRenderer: () => null,
}));
vi.mock("@/components/tag-input", () => ({ TagInput: () => null }));
vi.mock("@/components/notebook-selector", () => ({
    NotebookSelector: ({ value }: { value?: string }) =>
        createElement("span", { "data-testid": "notebook" }, value),
}));
vi.mock("@/components/geogebra-demo", () => ({
    GeogebraDemo: ({ commands }: { commands: string }) =>
        createElement("pre", { "data-testid": "geogebra" }, commands),
}));
import { CorrectionEditor } from "@/components/correction-editor";
const image = "data:image/jpeg;base64,b3JpZ2luYWw=";
const question: ParsedQuestion = {
    questionText: "合成几何题",
    answerText: "合成答案",
    analysis: "合成解析",
    subject: "数学",
    knowledgePoints: [],
    wrongAnswerText: "",
    mistakeAnalysis: "",
    mistakeStatus: "unknown",
    requiresImage: true,
};
const geometry = {
    suitable: true,
    commands: ["A=(0,0)"],
    description: "合成几何演示",
};
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let terminalState: string;
const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    terminalState = "success";
    fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/notebooks") return response([]);
        if (url === "/api/user") return response({});
        if (url === "/api/geogebra-analyze")
            return response({ jobId: "geometry-job" }, 202);
        if (url === "/api/reanswer")
            return response({ jobId: "reanswer-job" }, 202);
        if (url === "/api/ai/jobs/geometry-job")
            return response({
                state: terminalState,
                result: geometry,
                errorCode: "AI_ACCEPTANCE_UNKNOWN",
            });
        if (url === "/api/ai/jobs/reanswer-job")
            return response({
                state: "success",
                result: { ...question, answerText: "新合成答案" },
            });
        throw new Error(`Unexpected mock URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
});
const render = async (data = question, preview: string | null = image) => {
    await act(async () => {
        root.render(
            createElement(CorrectionEditor, {
                initialData: data,
                imagePreview: preview,
                onSave: vi.fn(),
                onCancel: vi.fn(),
                initialSubjectId: "owned-notebook",
            }),
        );
    });
};
const button = (label: string) =>
    [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(label),
    );
const bodyFor = (path: string) => {
    const call = fetchMock.mock.calls.find(([url]) => url === path);
    expect(call).toBeDefined();
    return JSON.parse(call![1].body as string);
};
describe("correction editor durable jobs (synthetic input, mocked network)", () => {
    it("polls a 202 GeoGebra job through apiClient and sends the original geometry image", async () => {
        await render();
        await act(async () => {
            button("生成演示")!.click();
        });
        expect(bodyFor("/api/geogebra-analyze")).toMatchObject({
            questionText: question.questionText,
            answerText: question.answerText,
            analysis: question.analysis,
            imageBase64: image,
            language: "zh",
            subjectId: "owned-notebook",
        });
        expect(
            fetchMock.mock.calls.some(
                ([url]) => url === "/api/ai/jobs/geometry-job",
            ),
        ).toBe(true);
        expect(
            host.querySelector('[data-testid="geogebra"]')?.textContent,
        ).toBe(JSON.stringify(geometry.commands));
    });
    it("allows image-only reanswering and does not fabricate question text", async () => {
        await render({ ...question, questionText: "" });
        const reanswer = button("Reanswer");
        expect(reanswer).toBeDefined();
        expect(reanswer!.disabled).toBe(false);
        await act(async () => {
            reanswer!.click();
        });
        expect(bodyFor("/api/reanswer")).toMatchObject({
            questionText: "",
            imageBase64: image,
        });
        expect(
            fetchMock.mock.calls.some(
                ([url]) => url === "/api/ai/jobs/reanswer-job",
            ),
        ).toBe(true);
    });
    it("offers GeoGebra for an image-only question with an answer", async () => {
        await render({ ...question, questionText: "" });
        expect(button("生成演示")).toBeDefined();
        await act(async () => {
            button("生成演示")!.click();
        });
        expect(bodyFor("/api/geogebra-analyze")).toMatchObject({
            questionText: "",
            imageBase64: image,
        });
    });
    it("keeps empty text plus no image disabled", async () => {
        await render({ ...question, questionText: "   " }, null);
        expect(button("Reanswer")!.disabled).toBe(true);
        expect(button("生成演示")).toBeUndefined();
    });
    it("sends the opt-in independent review with reanswering", async () => {
        await render();
        await act(async () => {
            host.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            )!.click();
        });
        await act(async () => {
            button("Reanswer")!.click();
        });
        expect(bodyFor("/api/reanswer")).toMatchObject({
            review: true,
            originalImageBase64: image,
            subjectId: "owned-notebook",
        });
    });
    it("supports text-only GeoGebra requests without inventing an image", async () => {
        await render(question, null);
        await act(async () => {
            button("生成演示")!.click();
        });
        expect(bodyFor("/api/geogebra-analyze").imageBase64).toBeUndefined();
        expect(host.querySelector('[data-testid="geogebra"]')).not.toBeNull();
    });
    it("accepts a late inferred notebook but does not overwrite an existing selection", async () => {
        const props = {
            initialData: question,
            imagePreview: image,
            onSave: vi.fn(),
            onCancel: vi.fn(),
        };
        await act(async () => {
            root.render(createElement(CorrectionEditor, props));
        });
        await act(async () => {
            root.render(
                createElement(CorrectionEditor, {
                    ...props,
                    initialSubjectId: "inferred-notebook",
                }),
            );
        });
        expect(
            host.querySelector('[data-testid="notebook"]')?.textContent,
        ).toBe("inferred-notebook");
        await act(async () => {
            root.render(
                createElement(CorrectionEditor, {
                    ...props,
                    initialSubjectId: "different-notebook",
                }),
            );
        });
        expect(
            host.querySelector('[data-testid="notebook"]')?.textContent,
        ).toBe("inferred-notebook");
    });
    it("does not interpret an unknown queued result as success or resubmit it", async () => {
        terminalState = "unknown";
        await render();
        await act(async () => {
            button("生成演示")!.click();
        });
        expect(host.querySelector('[data-testid="geogebra"]')).toBeNull();
        expect(host.textContent).toContain("任务");
        expect(
            fetchMock.mock.calls.filter(
                ([url]) => url === "/api/geogebra-analyze",
            ),
        ).toHaveLength(1);
        expect(
            fetchMock.mock.calls.some(
                ([url]) => url === "/api/ai/jobs/geometry-job",
            ),
        ).toBe(true);
    });
});
