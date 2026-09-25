import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { PortableConfig } from "@/lib/ai-config/schema";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: mocks }));
import AIManagement from "@/app/admin/ai/page";
let root: Root, host: HTMLDivElement, config: PortableConfig;
const click = async (node: Element) => { await act(async () => (node as HTMLElement).click()); };
const button = (name: string, scope: ParentNode = document) => {
    const node = [...scope.querySelectorAll("button")].find((b) => b.textContent === name);
    if (!node) throw Error(`Missing button: ${name}`); return node;
};
const labeledInput = (name: string, scope: ParentNode = document) => {
    const label = [...scope.querySelectorAll("label")].find((l) => l.textContent === name);
    if (!label) throw Error(`Missing input: ${name}`); return label.querySelector("input")!;
};
const fill = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
};
const renderEditor = async () => { await render(); await click(button("合成连接A")); };
const render = async () => { await act(async () => root.render(<AIManagement />)); };
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    config = { version: 1,
        providers: [{ id: "p1", name: "合成连接A", protocol: "chat", baseUrl: "https://example.invalid/v1", apiKey: "********", enabled: true }],
        models: [{ id: "m1", providerId: "p1", name: "合成模型A", model: "model-a", capabilities: ["text"], enabled: true }],
        chains: { text: ["m1"], vision: [] },
    };
    mocks.get.mockImplementation(async url=>url==="/api/ai/dialogue-settings"?{defaultRounds:10,revision:0}:{config,revision:4});
    mocks.post.mockImplementation(async (_url, body) => ({ config: body.config, revision: 5 }));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("admin AI two-level editor", () => {
    it("shows compact connection cards, no JSON and a closed import dialog", async () => {
        await render(); expect(host.textContent).toContain("一张连接卡片对应一把Key");
        expect(host.querySelector("pre")).toBeNull(); expect(document.querySelector('[type="file"]')).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.querySelector('[aria-label="添加text链模型"]')).not.toBeNull();
        expect(button("保存设置").disabled).toBe(true);
    });
    it("opens import on demand without saving or showing credential details", async () => {
        await render(); await click(button("导入配置"));
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(document.querySelector('[aria-label="加密配置文件"]')).not.toBeNull();
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it("creates a same-endpoint second key without copying credentials or models", async () => {
        await renderEditor(); await click(button("同地址添加另一把Key"));
        const cards = [...host.querySelectorAll('[data-connection-card]')];
        expect(cards).toHaveLength(2);
        const key = labeledInput("API密钥", document.querySelector('[role="dialog"]')!); expect(key.value).toBe("");
        await fill(key, "synthetic-new-key"); await click(button("保存设置"));
        const saved = mocks.post.mock.calls[0][1].config as PortableConfig;
        expect(saved.providers[0].apiKey).toBe("********");
        expect(saved.providers[1].baseUrl).toBe(saved.providers[0].baseUrl);
        expect(saved.providers[1].apiKey).toBe("synthetic-new-key");
        expect(saved.providers[1].id).not.toBe(saved.providers[0].id);
        expect(saved.models).toHaveLength(1);
    });
    it("adds multiple models to the selected key and keeps new capabilities separate from explicit task selection", async () => {
        await renderEditor(); await click(button("＋添加模型"));
        const fields = [...document.querySelectorAll("label")].filter((l) => l.textContent === "上游模型/部署名");
        await fill(fields[1].querySelector("input")!, "model-b");
        expect(fields[1].closest("[data-model-editor]")).not.toBeNull();
        const capability = [...document.querySelectorAll("label")].filter((l) => l.textContent === "支持读图（多模态）")[1].querySelector("input")!;
        await click(capability); await click(button("保存设置"));
        const saved = mocks.post.mock.calls[0][1].config as PortableConfig;
        expect(saved.models).toHaveLength(2); expect(saved.models[1].providerId).toBe("p1");
        expect(saved.models[1].capabilities).toEqual(["text", "vision"]);
        expect(saved.chains.text).toEqual(["m1"]); expect(saved.chains.vision).toEqual([]);
    });
    it("preserves reversed imported orders and legacy vision-only capability", async () => {
        config.models[0].capabilities = ["text", "vision"];
        config.models.push({ ...config.models[0], id: "m2", name: "合成模型B" });
        config.models.push({ ...config.models[0], id: "m3", name: "旧视觉模型", capabilities: ["vision"] });
        config.chains = { text: ["m1", "m2"], vision: ["m2", "m1", "m3"] };
        await renderEditor(); expect(host.textContent).toContain("两种调用顺序"); expect(document.body.textContent).toContain("仅图片（旧配置保留）");
        await fill(labeledInput("连接名称"), "重命名连接"); await click(button("保存设置"));
        const saved = mocks.post.mock.calls[0][1].config as PortableConfig;
        expect(saved.chains).toEqual(config.chains); expect(saved.models[2].capabilities).toEqual(["vision"]);
    });
    it("does not silently switch custom orders or delete a connection when confirmation is declined", async () => {
        config.models[0].capabilities = ["text", "vision"];
        config.chains = { text: ["m1"], vision: [] };
        vi.mocked(window.confirm).mockReturnValue(false);
        await renderEditor(); await click(button("移除连接"));
        expect(host.textContent).toContain("两种调用顺序"); expect(host.textContent).toContain("合成连接A");
        expect(button("保存设置").disabled).toBe(true); expect(mocks.post).not.toHaveBeenCalled();
    });
    it("disables editing after a failed load instead of offering to overwrite an empty config", async () => {
        mocks.get.mockRejectedValue(Error("forbidden")); await render();
        expect(host.textContent).toContain("无法读取"); expect(button("保存设置").disabled).toBe(true);
        expect(button("＋添加连接").closest("fieldset")!.disabled).toBe(true);
    });
    it("prunes selected models when their connection is disabled and does not reselect them implicitly", async () => {
        await renderEditor(); await click(labeledInput("启用连接"))
        await click(button("保存设置"));
        expect(mocks.post.mock.calls[0][1].config.chains).toEqual({ text: [], vision: [] });
    });
    it("keeps advanced capability edits separate from task selection", async () => {
        config.models.push({ ...config.models[0], id: "m2", name: "合成模型B", capabilities: ["text", "vision"] });
        config.chains = { text: ["m1", "m2"], vision: [] };
        await renderEditor(); await click(labeledInput("支持读图（多模态）")); await click(button("保存设置"));
        expect(mocks.post.mock.calls[0][1].config.chains).toEqual(config.chains);
    });
    it("requires explicit task selection before widening old task membership", async () => {
        config.models[0].capabilities = ["text", "vision"];
        await renderEditor();
        await act(async()=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="添加vision链模型"]')!;select.value="m1";select.dispatchEvent(new Event("change",{bubbles:true}));});
        await click(button("保存设置"));
        expect(mocks.post.mock.calls[0][1].config.chains).toEqual({ text: ["m1"], vision: ["m1"] });
    });

    it("requires saving local edits before duplicate detection", async () => {
        await renderEditor(); expect(button("检测与合并").disabled).toBe(false);
        await click(labeledInput("启用连接")); expect(button("检测与合并").disabled).toBe(true);
        await click(button("保存设置")); expect(button("检测与合并").disabled).toBe(false);
    });
});

describe("encrypted import feedback in the actual dialog", () => {
    it.each([
        [401, "UNAUTHORIZED", "重新登录"],
        [404, "not-json", "后台"],
        [400, "IMPORT_CONFIG_INCOMPATIBLE", "口令验证已通过"],
        [400, "AI_MASTER_KEY_MISSING", "主钥"],
        [409, "CONFIG_CONFLICT", "重新预览"],
    ])("shows a safe, actionable reason for HTTP %s / %s", async (status, message, expected) => {
        await render(); await click(button("导入配置"));
        const input = document.querySelector<HTMLInputElement>('[aria-label="加密配置文件"]')!;
        Object.defineProperty(input, "files", { value: [{ size: 2, text: async () => "{}" }] });
        await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
        await fill(document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!, "synthetic-test-password");
        mocks.post.mockRejectedValueOnce({ status, data: { message, private: "synthetic-must-not-render" } });
        await click(button("解密并预览（不写入）", document));
        expect(document.body.textContent).toContain(expected);
        expect(document.body.textContent).not.toContain("synthetic-must-not-render");
        expect(document.body.textContent).not.toContain("口令错误、文件被改动、格式不兼容或预览已过期");
    });
});


describe("sticky save and explicit connectivity check",()=>{
 it("keeps the unique save button in a floating footer",async()=>{
  await render();const save=button("保存设置");expect(save.closest('[aria-label="AI设置保存栏"]')?.className).toContain("fixed");
 });
 it("tests only a saved model after cost confirmation and never sends credentials",async()=>{
  await renderEditor();expect(mocks.post).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValueOnce(false);await click(button("测试连通性"));expect(mocks.post).not.toHaveBeenCalled();
  mocks.post.mockResolvedValueOnce({success:true,elapsedMs:25});await click(button("测试连通性"));
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/ai/config/test",{modelId:"m1",revision:4});expect(document.body.textContent).toContain("连通成功");
  await fill(labeledInput("连接名称"),"changed");expect(button("测试连通性").disabled).toBe(true);
 });
});


describe("connection dialog contract", () => {
    it("opens from the connection name, edits models in the dialog and retains unsaved drafts on close", async () => {
        await render();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(host.querySelector('input[type="password"]')).toBeNull();
        await click(button("合成连接A"));
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog).not.toBeNull();
        expect(dialog.querySelector('details')).toBeNull();
        await fill(labeledInput("连接名称", dialog), "草稿连接");
        expect(mocks.post).not.toHaveBeenCalled();
        expect(button("保存全部AI设置", dialog).closest('[data-connection-save]')).not.toBeNull();
        await click(button("关闭（保留草稿）", dialog));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await click(button("草稿连接"));
        expect(labeledInput("连接名称", document).value).toBe("草稿连接");
        await click(button("保存全部AI设置", document));
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/ai/config", expect.objectContaining({revision:4}));
    });
    it("blocks portal fields while saving and retains the draft after failure", async () => {
        await render(); await click(button("合成连接A"));
        await fill(labeledInput("连接名称", document), "未写入草稿");
        let reject!: (e: Error) => void;
        mocks.post.mockImplementationOnce(() => new Promise((_, r) => {reject = r;}));
        await click(button("保存全部AI设置", document));
        expect(labeledInput("连接名称", document).closest("fieldset")!.disabled).toBe(true);
        await act(async () => reject(new Error("synthetic")));
        expect(labeledInput("连接名称", document).value).toBe("未写入草稿");
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain("保存失败");
        expect(button("保存全部AI设置", document).disabled).toBe(false);
    });
});
