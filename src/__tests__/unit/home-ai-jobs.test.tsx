import type { AIConversation } from "@/components/ai-conversation";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorrectionEditor } from "@/components/correction-editor";
import type { ImageCropper } from "@/components/image-cropper";
import type { UploadZone } from "@/components/upload-zone";
import type { TextInputZone } from "@/components/text-input-zone";
import type { ParsedQuestion } from "@/lib/ai/types";

const mocks = vi.hoisted(() => ({
    conversation: null as ComponentProps<typeof AIConversation> | null,
    search: "",
    router: { push: vi.fn(), replace: vi.fn() },
    processImage: vi.fn(),
    editor: null as ComponentProps<typeof CorrectionEditor> | null,
    cropper: null as ComponentProps<typeof ImageCropper> | null,
    upload: null as ComponentProps<typeof UploadZone> | null,
    text: null as ComponentProps<typeof TextInputZone> | null,
}));
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(mocks.search),
    useRouter: () => mocks.router,
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ processImageFile: mocks.processImage }));
vi.mock("@/lib/frontend-logger", () => ({
    frontendLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({
        language: "zh",
        t: { app: {}, common: { messages: {} }, errors: {} },
    }),
}));
vi.mock("@/components/user-welcome", () => ({ UserWelcome: () => null }));
vi.mock("@/components/settings-dialog", () => ({ SettingsDialog: () => null }));
vi.mock("@/components/broadcast-notification", () => ({
    BroadcastNotification: () => null,
}));
vi.mock("@/components/direct-text-editor", () => ({
    DirectTextEditor: () => null,
}));
vi.mock("@/components/ui/progress-feedback", () => ({
    ProgressFeedback: ({ status }: { status: string }) =>
        createElement("div", { "data-overlay-status": status }),
}));
vi.mock("@/components/correction-editor", () => ({
    CorrectionEditor: (props: ComponentProps<typeof CorrectionEditor>) => {
        mocks.editor = props;
        const [initial] = useState(props.initialData); return createElement("div", { "data-testid": "editor" }, initial.answerText);
    },
}));
vi.mock("@/components/image-cropper", () => ({
    ImageCropper: (props: ComponentProps<typeof ImageCropper>) => {
        mocks.cropper = props;
        return null;
    },
}));
vi.mock("@/components/upload-zone", () => ({
    UploadZone: (props: ComponentProps<typeof UploadZone>) => {
        mocks.upload = props;
        return null;
    },
}));
vi.mock("@/components/text-input-zone", () => ({
    TextInputZone: (props: ComponentProps<typeof TextInputZone>) => {
        mocks.text = props;
        return null;
    },
}));
import Home from "@/app/page";

vi.mock("@/components/ai-conversation", () => ({ AIConversation: (props: ComponentProps<typeof AIConversation>) => { mocks.conversation = props; return null; } }));

const original = "data:image/jpeg;base64,b3JpZ2luYWw=";
const compressed = "data:image/jpeg;base64,Y29tcHJlc3NlZA==";
const result: ParsedQuestion = {
    questionText: "合成题目",
    answerText: "合成答案",
    analysis: "合成解析",
    subject: "英语",
    knowledgePoints: [],
    wrongAnswerText: "",
    mistakeAnalysis: "",
    mistakeStatus: "unknown",
    requiresImage: true,
};
const notebooks = [{ id: "english-notebook", name: "英语" }];
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let jobState: string;
let restoreStatus: number;
let restoreInput: Record<string, unknown>;
let jobKind: string;
const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
        "FileReader",
        class {
            result = original;
            onload: (() => void) | null = null;
            readAsDataURL() {
                this.onload?.();
            }
        },
    );
    vi.stubGlobal("URL", URL);
    URL.createObjectURL = vi.fn(() => "blob:synthetic-crop");
    URL.revokeObjectURL = vi.fn();
    mocks.search = "";
    mocks.editor = null;
    mocks.cropper = null;
    mocks.upload = null;
    mocks.text = null;
    mocks.processImage.mockResolvedValue(compressed);
    jobState = "success";
    restoreStatus = 200;
    jobKind = "analyze";
    restoreInput = { originalImageBase64: original, imageBase64: compressed };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/ai/conversations" && init?.method === "POST") return response({id:"new-conversation"},201);
        if (url === "/api/notebooks") return response(notebooks);
        if (url === "/api/settings")
            return response({ timeouts: { analyze: 180000 } });
        if (url === "/api/analyze" || url === "/api/reanswer")
            return response({ jobId: "owned-job" }, 202);
        if (url === "/api/ai/jobs/owned-job?restore=1")
            return response(
                {
                    id: "owned-job",
                    kind: jobKind,
                    state: jobState,
                    input: restoreInput,
                    result,
                },
                restoreStatus,
            );
        if (url === "/api/ai/jobs/owned-job")
            return response({ id: "owned-job", state: jobState, result });
        if (url === "/api/error-items" && init?.method === "POST")
            return response({ id: "saved-item" });
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
        await vi.runOnlyPendingTimersAsync();
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
const render = async (legacy = true) => {
    await act(async () => {
        root.render(createElement(Home));
    });
    if (legacy) await act(async () => { const mode=host.querySelector("select"); if(mode){mode.value="direct";mode.dispatchEvent(new Event("change",{bubbles:true}));} });
};
const clickTab = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
    );
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
};
const bodyFor = (path: string) => {
    const call = fetchMock.mock.calls.find(
        ([url, init]) => url === path && init?.method === "POST",
    );
    expect(call).toBeDefined();
    return JSON.parse(call![1].body as string);
};
const crop = async (blob = new Blob(["synthetic"], { type: "image/jpeg" })) => {
    await act(async () => {
        mocks.upload!.onImageSelect(
            new File(["source"], "source.jpg", { type: "image/jpeg" }),
        );
    });
    await act(async () => {
        await mocks.cropper!.onCropComplete(blob);
    });
};

describe("home durable AI integration (synthetic input, mocked network)", () => {
    it("preserves the cropped original separately from the compressed AI request and saved image", async () => {
        await render();
        await crop();
        expect(bodyFor("/api/analyze")).toMatchObject({
            imageBase64: compressed,
            originalImageBase64: original,
            mode: "direct",
            review: false,
        });
        expect(mocks.editor?.imagePreview).toBe(original);
        await act(async () => {
            await mocks.editor!.onSave({
                ...result,
                subjectId: "english-notebook",
            });
        });
        expect(bodyFor("/api/error-items").originalImageUrl).toBe(original);
    });
    it("sends supplemental text, transcribe mode and opt-in independent review together with the image", async () => {
        await render();
        const textarea = host.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="图片补充文字"]',
        );
        const select = host.querySelector("select");
        const review = host.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
        );
        expect(textarea).not.toBeNull();
        expect(select).not.toBeNull();
        expect(review).not.toBeNull();
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )!.set!.call(textarea, "合成图形补充");
            textarea!.dispatchEvent(new Event("input", { bubbles: true }));
            select!.value = "transcribe";
            select!.dispatchEvent(new Event("change", { bubbles: true }));
            review!.click();
        });
        await crop();
        expect(bodyFor("/api/analyze")).toMatchObject({
            questionText: "合成图形补充",
            mode: "transcribe",
            review: true,
            originalImageBase64: original,
            imageBase64: compressed,
        });
    });
    it("uses analyze for text input without fabricating a subject or an image", async () => {
        await render();
        await clickTab("AI解题");
        await act(async () => {
            await mocks.text!.onSubmit("合成文字题");
        });
        expect(bodyFor("/api/analyze")).toMatchObject({
            questionText: "合成文字题",
            mode: "text",
            review: false,
        });
        expect(bodyFor("/api/analyze").subject).toBeUndefined();
        expect(bodyFor("/api/analyze").imageBase64).toBeUndefined();
        expect(
            fetchMock.mock.calls.some(([url]) => url === "/api/reanswer"),
        ).toBe(false);
        expect(mocks.editor?.initialData).toEqual(result);
        expect(mocks.editor?.imagePreview).toBeNull();
        expect(mocks.editor?.initialSubjectId).toBe("english-notebook");
    });
    it("rejects a cropped image over 8MiB before reading, compressing or posting it", async () => {
        await render();
        await crop(
            new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], {
                type: "image/jpeg",
            }),
        );
        expect(mocks.processImage).not.toHaveBeenCalled();
        expect(
            fetchMock.mock.calls.some(([url]) => url === "/api/analyze"),
        ).toBe(false);
        expect(alert).toHaveBeenCalledWith(expect.stringContaining("8MiB"));
    });
    it("accepts the exact 8MiB boundary", async () => {
        await render();
        await crop(
            new Blob([new Uint8Array(8 * 1024 * 1024)], { type: "image/jpeg" }),
        );
        expect(bodyFor("/api/analyze").originalImageBase64).toBe(original);
    });
    it("preserves a notebook query context and optional review for text jobs", async () => {
        mocks.search = "notebook=context-notebook";
        await render();
        await clickTab("AI解题");
        await act(async () => {
            host.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
            )!.click();
        });
        await act(async () => {
            await mocks.text!.onSubmit("合成文字题");
        });
        expect(bodyFor("/api/analyze")).toMatchObject({
            subjectId: "context-notebook",
            review: true,
            mode: "text",
        });
        expect(mocks.editor?.initialSubjectId).toBe("context-notebook");
    });
    it("guards duplicate crop submissions while the same job is active", async () => {
        jobState = "running";
        await render();
        await crop();
        await act(async () => {
            mocks.cropper!.onCropComplete(
                new Blob(["duplicate"], { type: "image/jpeg" }),
            );
        });
        expect(
            fetchMock.mock.calls.filter(([url]) => url === "/api/analyze"),
        ).toHaveLength(1);
        jobState = "success";
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
    });
    it("stops local polling on navigation but never cancels or resubmits the server job", async () => {
        jobState = "running";
        await render();
        await crop();
        await act(async () => {
            root.render(null);
        });
        const calls = fetchMock.mock.calls.length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10000);
        });
        expect(fetchMock).toHaveBeenCalledTimes(calls);
        expect(
            fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
        ).toBe(false);
        expect(
            fetchMock.mock.calls.filter(([url]) => url === "/api/analyze"),
        ).toHaveLength(1);
    });
    it("restores an owned job without subjectId through the authenticated restore endpoint", async () => {
        mocks.search = "job=owned-job";
        await render();
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/ai/jobs/owned-job?restore=1",
            expect.objectContaining({ method: "GET" }),
        );
        expect(mocks.editor?.initialData).toEqual(result);
        expect(mocks.editor?.imagePreview).toBe(original);
        expect(
            fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
        ).toBe(false);
    });
    it("retains the original notebook when restoring instead of guessing from the model subject", async () => {
        mocks.search = "job=owned-job";
        restoreInput.subjectId = "original-notebook";
        await render();
        expect(mocks.editor?.initialSubjectId).toBe("original-notebook");
    });
    it("does not reveal results when the owner-scoped endpoint rejects access", async () => {
        mocks.search = "job=owned-job";
        restoreStatus = 404;
        await render();
        expect(mocks.editor).toBeNull();
        expect(host.textContent).toMatch(/不存在|不可访问|过期/);
    });
    it("does not treat another job kind as an analysis result", async () => {
        mocks.search = "job=owned-job";
        jobKind = "geogebra";
        await render();
        expect(mocks.editor).toBeNull();
        expect(host.textContent).toContain("任务");
    });
    it("resumes polling a pending restore without submitting another paid job", async () => {
        mocks.search = "job=owned-job";
        jobState = "pending";
        await render();
        expect(mocks.editor).toBeNull();
        jobState = "success";
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
        expect(mocks.editor?.imagePreview).toBe(original);
        expect(
            fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
        ).toBe(false);
    });
    it("unlocks the home form when leaving a pending restore query on the same page", async () => {
        mocks.search = "job=owned-job";
        jobState = "pending";
        await render();
        expect(mocks.upload?.isAnalyzing).toBe(true);
        mocks.search = "";
        await render();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
        expect(mocks.upload?.isAnalyzing).toBe(false);
        expect(
            fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
        ).toBe(false);
    });
    it("supports older restored jobs that only retained their request image", async () => {
        mocks.search = "job=owned-job";
        delete restoreInput.originalImageBase64;
        await render();
        expect(mocks.editor?.imagePreview).toBe(compressed);
    });
    it.each(["failed", "cancelled", "unknown"])(
        "does not restart or edit a %s job",
        async (state) => {
            mocks.search = "job=owned-job";
            jobState = state;
            await render();
            expect(mocks.editor).toBeNull();
            expect(host.textContent).toContain("不要连续重复提交");
            expect(
                fetchMock.mock.calls.some(
                    ([, init]) => init?.method === "POST",
                ),
            ).toBe(false);
        },
    );
    it("keeps the job pending beyond 180 seconds and leaves task recovery navigation accessible", async () => {
        jobState = "running";
        await render();
        await crop();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(191000);
        });
        expect(mocks.upload?.isAnalyzing).toBe(true);
        expect(
            host.querySelector('[data-overlay-status="analyzing"]'),
        ).toBeNull();
        expect(host.querySelector('a[href="/ai-tasks"]')).not.toBeNull();
        expect(
            fetchMock.mock.calls.filter(([url]) => url === "/api/analyze"),
        ).toHaveLength(1);
        jobState = "success";
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100);
        });
        expect(mocks.editor?.initialData).toEqual(result);
    });
});


describe("home conversation default",()=>{
 it("creates a persistent conversation from the image without starting a legacy job",async()=>{
  await render(false);await crop();expect(bodyFor("/api/ai/conversations")).toMatchObject({imageBase64:compressed,originalImageBase64:original});
  expect(fetchMock.mock.calls.some(([url])=>url==="/api/analyze")).toBe(false);expect(mocks.router.replace).toHaveBeenCalledWith("/?conversation=new-conversation");
 });
 it("starts text-only dialogue without a fabricated notebook",async()=>{
  await render(false);await clickTab("AI解题");await act(async()=>{await mocks.text!.onSubmit("synthetic follow-up-ready question");});
  expect(bodyFor("/api/ai/conversations")).toMatchObject({questionText:"synthetic follow-up-ready question",mode:"text"});
  expect(bodyFor("/api/ai/conversations").subjectId).toBeUndefined();
 });
});


describe("shared inline conversation editor",()=>{
 it("renders the shared conversation without a second manual retrieval callback",async()=>{
  mocks.search="conversation=synthetic-conversation";await render();expect(mocks.conversation).toBeDefined();expect(mocks.conversation).not.toHaveProperty("onUseResult");
 });
});
