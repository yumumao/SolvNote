import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { DedupePreview } from "@/lib/ai-config/deduplicate";
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: mocks }));
import { AIConfigDeduplicate } from "@/components/ai-config-deduplicate";
let root: Root, host: HTMLDivElement, p: DedupePreview;
const applied = vi.fn();
const click = async (node: Element) => { await act(async () => (node as HTMLElement).click()); };
const button = (text: string) => {
    const node = [...document.querySelectorAll("button")].find(b => b.textContent === text);
    if (!node) throw Error(`Missing button: ${text}`); return node;
};
async function render(disabled = false) { await act(async () => root.render(<AIConfigDeduplicate disabled={disabled} onApplied={applied} />)); }
async function detect() { await render(); await click(button("检测与合并")); await click(button("检测已保存配置")); }
async function select(kind: string, value: string) {
    const el = document.querySelector(`select[aria-label="${kind}"]`) as HTMLSelectElement;
    expect(el).not.toBeNull();
    await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const before: DedupePreview["before"] = { version:1,
        providers: ["a", "b", "c"].map(id => ({id,name:`连接${id}`,protocol:"chat",baseUrl:"https://example.invalid/v1",apiKey:"********",enabled:true})),
        models: ["m1", "m2"].map((id, i) => ({id,providerId:i?"b":"a",name:id,model:"same",capabilities:["text","vision"],enabled:true})),
        chains:{text:["m2","m1"],vision:["m1","m2"]},
    };
    p = { before, config:{...before,providers:[before.providers[0],before.providers[2]],models:[before.models[0]],chains:{text:["m1"],vision:["m1"]}},
        groups:[{kind:"connection",groupId:"a",keepId:"a",conflict:false,members:before.providers.slice(0,2).map(x=>({id:x.id,label:x.name,enabled:true}))},
            {kind:"model",groupId:"m1",keepId:null,conflict:true,members:before.models.map(x=>({id:x.id,label:x.name,enabled:true,capabilities:x.capabilities}))}],
        endpoints:[{connectionIds:["a","b","c"],keyGroups:[["a","b"],["c"]],unknownIds:[]}], changed:true,revision:4,nonce:"n",expires:Date.now()+300000,previewToken:"t" };
    applied.mockReset(); mocks.post.mockReset().mockResolvedValue(p);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("AI duplicate detection dialog", () => {
    it("disables detection while the editor cannot provide a saved snapshot", async () => {
        await render(true); expect(button("检测与合并").disabled).toBe(true); expect(mocks.post).not.toHaveBeenCalled();
    });
    it("only detects on request, shows key equivalence and leaves conflicts separate", async () => {
        await render(); await click(button("检测与合并")); expect(mocks.post).not.toHaveBeenCalled();
        await click(button("检测已保存配置"));
        expect(mocks.post).toHaveBeenCalledWith("/api/ai/config/deduplicate", {action:"preview",choices:[]});
        expect(document.body.textContent).toContain("Key相同"); expect(document.body.textContent).toContain("不同组的Key不同");
        expect(document.body.textContent).toContain("能力或启用状态不同");
        expect((document.querySelector('select[aria-label="模型合并 m1"]') as HTMLSelectElement).value).toBe("");
        expect(applied).not.toHaveBeenCalled();
    });
    it("requires a new preview after choosing which conflict member to keep", async () => {
        await detect(); await select("模型合并 m1", "m2"); expect(button("确认应用合并").disabled).toBe(true);
        expect(applied).not.toHaveBeenCalled(); await click(button("按当前选择重新预览"));
        expect(mocks.post.mock.calls.at(-1)?.[1]).toEqual({action:"preview",choices:[{kind:"model",groupId:"m1",keepId:"m2"}]});
        expect(button("确认应用合并").disabled).toBe(false);
    });
    it("drops obsolete model decisions when connection grouping changes", async () => {
        await detect(); await select("模型合并 m1", "m2"); await select("连接合并 a", "");
        expect(document.querySelector('select[aria-label="模型合并 m1"]')).toBeNull();
        await click(button("按当前选择重新预览"));
        expect(mocks.post.mock.calls.at(-1)?.[1].choices).toEqual([{kind:"connection",groupId:"a",keepId:null}]);
    });
    it("applies only the approved server preview, never submits masked config", async () => {
        await detect(); mocks.post.mockResolvedValue({config:p.config,revision:5}); await click(button("确认应用合并"));
        expect(mocks.post.mock.calls.at(-1)?.[1]).toEqual({action:"apply",choices:[],revision:4,nonce:"n",expires:p.expires,previewToken:"t"});
        expect(applied).toHaveBeenCalledWith(p.config,5); expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    it("clears invalid previews and does not replace the editor after a rejected apply", async () => {
        await detect(); mocks.post.mockRejectedValue(Error("SYNTHETIC_PRIVATE_ERROR")); await click(button("确认应用合并"));
        expect(applied).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("SYNTHETIC_PRIVATE_ERROR");
        expect(document.body.textContent).toContain("重新检测"); expect([...document.querySelectorAll("button")].some(b=>b.textContent==="确认应用合并")).toBe(false);
    });
    it("does not permit applying an unchanged result", async () => {
        p.changed=false; await detect(); expect(button("确认应用合并").disabled).toBe(true);
        expect(document.body.textContent).toContain("没有需要应用的变更");
    });
    it("blocks duplicate submission and closing during detection", async () => {
        let finish!: (v: DedupePreview)=>void;
        mocks.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
        await render(); await click(button("检测与合并")); await click(button("检测已保存配置"));
        expect(button("检测已保存配置").disabled).toBe(true); await click(button("检测已保存配置"));
        await act(async()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));});
        expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(mocks.post).toHaveBeenCalledTimes(1);
        await act(async()=>finish(p));
    });
});
