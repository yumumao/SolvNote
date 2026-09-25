import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/geogebra-demo", () => ({ GeogebraDemo: () => <div>external</div> }));
vi.mock("@/components/ai-conversation", () => ({ dialogueLabels: {} }));
import { ConstructionSchema, compileConstruction, CONSTRUCTION_PROMPT } from "@/lib/ai-drawing/construction";
import { AuxiliaryDrawing, DrawingResultPreview } from "@/components/auxiliary-drawing";
import AITasks from "@/app/ai-tasks/page";
import { apiClient } from "@/lib/api-client";
const source = "data:image/png;base64,YQ==";
const raw = { title: "合成圆面积底图", points: [{ id: "O", x: 100, y: 100 }, { id: "A", x: 104, y: 100 }], segments: [], circles: [{ center: "O", through: "A" }], steps: [{ description: "连接已知半径", operation: { kind: "segment", a: "O", b: "A" } }] };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); window.history.replaceState(null, "", "/"); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });
const render = async (element: React.ReactNode) => { await act(async () => root.render(element)); };
const click = async (text: string) => { const b = [...host.querySelectorAll("button")].find(b => b.textContent === text); expect(b).toBeDefined(); await act(async () => b!.click()); };
describe("original circle foundation", () => {
    it("compiles full original circles into the base without treating them as auxiliary steps", () => {
        const plan = ConstructionSchema.parse(raw), r = compileConstruction(plan);
        expect(r.base).toContain("baseCircle0=Circle(O,A)");
        expect(r.geometry.circles).toEqual([{ x: 100, y: 100, radius: 4, step: 0 }]);
        expect(r.steps).toHaveLength(1);
    });
    it("keeps old plans compatible but rejects undefined, degenerate and excessive circles", () => {
        const { circles, ...old } = raw;
        expect(() => compileConstruction(ConstructionSchema.parse(old))).not.toThrow();
        for (const invalid of [[{ center: "O", through: "Z" }], [{ center: "O", through: "O" }], Array(17).fill(circles[0])]) {
            expect(() => compileConstruction(ConstructionSchema.parse({ ...raw, circles: invalid }))).toThrow();
        }
        expect(() => compileConstruction(ConstructionSchema.parse({ ...raw, points: [{ id: "O", x: 0, y: 0 }, { id: "A", x: 0, y: 0 }] }))).toThrow();
    });
    it("fits the complete circle and keeps it visible at step zero, with a separate original image", async () => {
        await render(<DrawingResultPreview result={{ type: "construction", plan: raw }} originalImage={source} />);
        expect(host.querySelector('img[alt="辅助线原题图对照"]')?.getAttribute("src")).toBe(source);
        const circle = host.querySelector('svg circle[data-base-circle]'); expect(circle).not.toBeNull();
        const x = Number(circle!.getAttribute("cx")), y = Number(circle!.getAttribute("cy")), radius = Number(circle!.getAttribute("r"));
        expect(x - radius).toBeGreaterThanOrEqual(35); expect(x + radius).toBeLessThanOrEqual(765);
        expect(y - radius).toBeGreaterThanOrEqual(35); expect(y + radius).toBeLessThanOrEqual(465);
        await click("上一步"); expect(host.querySelectorAll('svg circle[data-base-circle]')).toHaveLength(1); expect(host.querySelectorAll("svg line")).toHaveLength(0);
        expect(host.textContent).toContain("不是在原图片上叠线");
    });
    it("requires the original foundation instead of silently omitting unsupported curves", () => {
        expect(CONSTRUCTION_PROMPT).toContain("先完整重建原题底图");
        expect(CONSTRUCTION_PROMPT).toContain('"circles"');
        expect(CONSTRUCTION_PROMPT).toContain("不得省略");
    });
    it("does not fetch arbitrary remote or executable original image URLs", async () => {
        const old = { ...raw, circles: undefined };
        for (const originalImage of ["https://private.example.invalid/q.png", "javascript:alert(1)", "data:image/svg+xml;base64,YQ=="]) {
            await render(<DrawingResultPreview result={{ type: "construction", plan: old }} originalImage={originalImage} />);
            expect(host.querySelector("img")).toBeNull();
        }
    });
});
describe("honest drawing acceptance and restoration", () => {
    it("notifies acceptance only after the server has returned a valid durable job id", async () => {
        let accept!: (r: Response) => void;
        const notify = vi.fn();
        const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { accept = r; })).mockResolvedValueOnce(response({ state: "success", result: { ok: true } }));
        vi.stubGlobal("fetch", fetchMock);
        const task = apiClient.post("/api/ai/drawing/construction", {}, { onJobAccepted: notify });
        expect(notify).not.toHaveBeenCalled(); accept(response({ jobId: "drawing-owned" }, 202));
        await expect(task).resolves.toEqual({ ok: true }); expect(notify).toHaveBeenCalledExactlyOnceWith("drawing-owned");
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("onJobAccepted");
    });
    it("rejects invalid acceptance ids without publishing a recovery link or polling", async () => {
        const notify = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(response({ jobId: "../another" }, 202));
        vi.stubGlobal("fetch", fetchMock);
        await expect(apiClient.post("/api/ai/drawing/construction", {}, { onJobAccepted: notify })).rejects.toMatchObject({ status: 502 });
        expect(notify).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("does not claim recovery while still submitting and gives the exact job link after acceptance", async () => {
        let accept!: (r: Response) => void;
        const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { accept = r; })).mockResolvedValueOnce(response({ state: "success", result: { type: "construction", plan: raw } }));
        vi.stubGlobal("fetch", fetchMock); vi.spyOn(window, "confirm").mockReturnValue(true);
        await render(<AuxiliaryDrawing questionText="合成题" answerText="合成答案" analysis="合成解析" image={source} />);
        await click("生成分步辅助线方案");
        expect(host.querySelector('[role="status"]')?.textContent).toContain("尚未确认受理");
        expect(host.querySelector('a[href="/ai-tasks?job=drawing-owned"]')).toBeNull();
        await act(async () => accept(response({ jobId: "drawing-owned" }, 202)));
        expect(host.querySelector('a[href="/ai-tasks?job=drawing-owned"]')).not.toBeNull();
        expect(host.textContent).toContain("不等于恢复当前编辑页");
        expect(host.querySelector('svg circle[data-base-circle]')).not.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await render(<AuxiliaryDrawing questionText="合成题" answerText="合成答案" analysis="合成解析" image="data:image/png;base64,Yg==" />);
        expect(host.querySelector('img[alt="辅助线原题图对照"]')?.getAttribute("src")).toBe(source);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("旧版本构造");
    });
    it("ignores stale detail responses and allows selecting the same job to retry", async () => {
        vi.useFakeTimers(); let finishOld!: (r: Response) => void; let reads = 0;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url === "/api/ai/conversations") return response({ conversations: [] });
            if (url === "/api/ai/jobs") return response({ jobs: ["old", "new"].map(id => ({ id, kind: "construction", state: "success", attempts: 1, createdAt: new Date().toISOString() })) });
            if (url.includes("/old?")) return new Promise<Response>(r => { finishOld = r; });
            if (url.includes("/new?")) { reads++; return response({ id: "new", kind: "construction", state: "success", result: { type: "construction", plan: raw } }); }
            throw Error("unexpected request");
        }));
        await render(<AITasks />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        const buttons = host.querySelectorAll("article button");
        await act(async () => (buttons[0] as HTMLButtonElement).click());
        await act(async () => (buttons[1] as HTMLButtonElement).click());
        await act(async () => finishOld(response({ id: "old", kind: "construction", state: "failed" })));
        expect(document.querySelector("svg")).not.toBeNull();
        await act(async () => (buttons[1] as HTMLButtonElement).click());
        expect(reads).toBe(2); expect(document.querySelector("svg")).not.toBeNull();
    });
    it("opens a copied job link, follows pending completion, restores the original and never posts", async () => {
        vi.useFakeTimers(); window.history.replaceState(null, "", "/ai-tasks?job=drawing-owned");
        let completed = false;
        const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
            expect(options.method).toBe("GET");
            if (url === "/api/ai/conversations") return response({ conversations: [] });
            if (url === "/api/ai/jobs") return response({ jobs: [{ id: "drawing-owned", kind: "construction", state: completed ? "success" : "running", attempts: 1, createdAt: new Date().toISOString() }] });
            if (url === "/api/ai/jobs/drawing-owned?restore=1") return response({ id: "drawing-owned", kind: "construction", state: completed ? "success" : "running", input: { imageBase64: source }, ...(completed ? { result: { type: "construction", plan: raw } } : {}) });
            throw Error("unexpected request");
        });
        vi.stubGlobal("fetch", fetchMock); await render(<AITasks />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("任务详情"); completed = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(document.querySelector('svg circle[data-base-circle]')).not.toBeNull();
        expect(document.querySelector('img[alt="辅助线原题图对照"]')).not.toBeNull();
        expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
    });
});
