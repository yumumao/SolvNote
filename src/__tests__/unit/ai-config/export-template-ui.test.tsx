import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: api, ApiError: class extends Error {} }));
vi.mock("@/components/ai-origin-status", () => ({ AIOriginStatus: () => null }));
vi.mock("@/components/ai-config-deduplicate", () => ({ AIConfigDeduplicate: () => null }));
vi.mock("@/components/ai-drawing-settings", () => ({ AIDrawingSettings: () => null }));
vi.mock("@/components/ai-dialogue-settings", () => ({ AIDialogueSettings: () => null }));
import AIManagement from "@/app/admin/ai/page";
const config = {version:1,providers:[],models:[],chains:{text:[],vision:[]}};
let root: Root, host: HTMLDivElement, capability: unknown;
const button = (name: string) => [...document.querySelectorAll("button")].find(b => b.textContent === name);
const render = async () => { await act(async () => root.render(<AIManagement/>)); };
const click = async (name: string) => { expect(button(name)).toBeDefined(); await act(async () => button(name)!.click()); };
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); capability = {exportEnabled:false};
    api.get.mockReset().mockImplementation(async url => {
        if (url === "/api/ai/config/export") return capability;
        if (url === "/api/ai/config") return {config,revision:4};
        throw Error("unexpected endpoint");
    });
    api.post.mockReset().mockResolvedValue({config,revision:4,expires:1000,previewToken:"synthetic-token"});
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([undefined, null, {}, {exportEnabled:false}, {exportEnabled:"true"}])("fails closed for capability %j but preserves import/edit/template", async value => {
    capability=value; vi.stubEnv("NEXT_PUBLIC_SOLVNOTE_ENABLE_AI_CONFIG_EXPORT", "true");
    await render();
    expect(api.get).toHaveBeenCalledWith("/api/ai/config/export");
    expect(button("导出配置")).toBeUndefined();
    expect(button("导入配置")!.disabled).toBe(false);
    expect(button("＋添加连接")!.closest("fieldset")!.disabled).toBe(false);
    const link=host.querySelector<HTMLAnchorElement>('a[href="/api/ai/config/template"]');
    expect(link?.textContent).toBe("下载导入模板"); expect(link?.hasAttribute("download")).toBe(true);
    await click("导入配置"); expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
});
it("shows export only with a literal true from the server", async () => {
    capability={exportEnabled:true}; await render(); expect(button("导出配置")!.disabled).toBe(false);
});
it("keeps template/import/edit usable when the capability request fails", async () => {
    api.get.mockImplementation(async url=> { if(url==="/api/ai/config") return {config,revision:4}; throw Error("offline"); });
    await render(); expect(button("导出配置")).toBeUndefined(); expect(button("导入配置")!.disabled).toBe(false);
    expect(host.querySelector('a[href="/api/ai/config/template"]')).not.toBeNull();
});
it("previews a locally filled JSON template without encryption password and without saving", async () => {
    await render(); await click("导入配置");
    const file = new File([JSON.stringify(config)], "local-template.json", {type:"application/json"});
    Object.defineProperty(file,"text",{value:async()=>JSON.stringify(config)});
    const input=document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input,"files",{value:[file],configurable:true});
    await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));
    expect(document.body.textContent).toContain("明文模板");
    await click("预览模板（不写入）");
    expect(api.post).toHaveBeenCalledExactlyOnceWith("/api/ai/config/import", {envelope:config,password:"",mode:"merge",action:"preview"});
    expect(button("确认合并导入")).toBeDefined();
});
it("still requires a passphrase for the encrypted format", async () => {
    await render(); await click("导入配置");
    const envelope={format:"portable-ai-config",v:1};
    const file=new File([JSON.stringify(envelope)],"encrypted.json");
    Object.defineProperty(file,"text",{value:async()=>JSON.stringify(envelope)});
    const input=document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input,"files",{value:[file],configurable:true});
    await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));
    expect(button("解密并预览（不写入）")!.disabled).toBe(true); expect(api.post).not.toHaveBeenCalled();
});
it("documents that vision import is not image output authorization", async () => {
    await render(); await click("导入配置");
    expect(document.body.textContent).toContain("ScanDex导入的vision仅表示文字＋读图多模态能力");
    expect(document.body.textContent).toContain("不会自动转移本站专用图片编辑授权");
    expect(document.body.textContent).toContain("Gemini图片输出模型");
});
