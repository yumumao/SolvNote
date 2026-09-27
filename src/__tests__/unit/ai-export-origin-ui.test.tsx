import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: api }));
import { AIConfigExport } from "@/components/ai-config-export";
import { AIOriginStatus } from "@/components/ai-origin-status";
let root: Root, host: HTMLDivElement;
const click = async (name: string) => { await act(async () => { const b = [...document.querySelectorAll("button")].find(b => b.textContent === name); if (!b) throw Error(name); b.click(); }); };
const fill = async (name: string, value: string) => { await act(async () => {
 const input = document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input,value);
 input.dispatchEvent(new Event("input",{bubbles:true}));
}); };
beforeEach(() => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); api.get.mockReset(); api.post.mockReset();
 host=document.createElement("div"); document.body.append(host); root=createRoot(host);
 Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn(()=>"blob:synthetic")});
 Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});
 vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const renderExport=async(disabled=false)=>{await act(async()=>root.render(<AIConfigExport revision={4} disabled={disabled} exportEnabled={true}/>));};
it("disables export for unsaved/unloaded settings",async()=>{await renderExport(true);expect(host.querySelector("button")!.disabled).toBe(true);});
it("requires matching independent passwords, then downloads encrypted envelope only",async()=>{
 await renderExport(); await click("导出配置");
 await fill("设置导出口令","synthetic-export-password");await fill("再次输入导出口令","different-password");await click("加密并下载");
 expect(api.post).not.toHaveBeenCalled();expect(document.body.textContent).toContain("两次口令不一致");
 await fill("再次输入导出口令","synthetic-export-password");
 api.post.mockResolvedValue({format:"portable-ai-config",v:1,alg:"AES-256-GCM",kdf:"PBKDF2-SHA256",iter:300000,salt:"synthetic",iv:"synthetic",data:"ciphertext"});
 await click("加密并下载");expect(api.post).toHaveBeenCalledWith("/api/ai/config/export",{revision:4,password:"synthetic-export-password"});
 expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
 expect(document.querySelector<HTMLInputElement>('[aria-label="设置导出口令"]')!.value).toBe("");
 await click("关闭");await click("导出配置");expect(document.querySelector<HTMLInputElement>('[aria-label="再次输入导出口令"]')!.value).toBe("");
});
it.each(["IMPORT_ORIGIN_REJECTED","CONFIG_CONFLICT","unknown-private-value"])("does not download or echo unsafe backend error %s",async code=>{
 await renderExport();await click("导出配置");await fill("设置导出口令","synthetic-export-password");await fill("再次输入导出口令","synthetic-export-password");
 api.post.mockRejectedValue({status:403,data:{message:code}});await click("加密并下载");expect(URL.createObjectURL).not.toHaveBeenCalled();
 expect(document.body.textContent).not.toContain("unknown-private-value");expect(document.querySelector<HTMLInputElement>('[aria-label="设置导出口令"]')!.value).toBe("");
});
it("never downloads a plaintext or malformed response",async()=>{
 await renderExport();await click("导出配置");await fill("设置导出口令","synthetic-export-password");await fill("再次输入导出口令","synthetic-export-password");api.post.mockResolvedValue({providers:[{apiKey:"private-value"}]});await click("加密并下载");expect(URL.createObjectURL).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain("private-value");
});
it.each(["missing","invalid","configured"])("shows actionable origin diagnostics: %s",async state=>{
 api.get.mockResolvedValue({state,canonicalOrigin:state==="configured"?"https://wrong.example.invalid":null});await act(async()=>root.render(<AIOriginStatus/>));
 expect(document.body.textContent).toContain(window.location.origin);expect(document.body.textContent).toContain("NEXTAUTH_URL");expect(document.body.textContent).toContain("ScanDex");
 if(state==="configured")expect(document.body.textContent).toContain("https://wrong.example.invalid");
});
it("does not warn when canonical origin matches",async()=>{
 api.get.mockResolvedValue({state:"configured",canonicalOrigin:window.location.origin});await act(async()=>root.render(<AIOriginStatus/>));expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.textContent).toContain("地址一致");
});

it("hides export unless given the explicit server capability", async () => {
 for (const capability of [undefined, false]) {
  await act(async()=>root.render(<AIConfigExport revision={4} disabled={false} exportEnabled={capability}/>));
  expect(host.querySelector("button")).toBeNull();
 }
 expect(api.post).not.toHaveBeenCalled();
});
it("handles the server disabling export after the capability was fetched", async () => {
 await renderExport();await click("导出配置");await fill("设置导出口令","synthetic-export-password");await fill("再次输入导出口令","synthetic-export-password");
 api.post.mockRejectedValue({status:403,data:{message:"AI_CONFIG_EXPORT_DISABLED"}});await click("加密并下载");
 expect(document.body.textContent).toContain("部署已关闭AI配置导出");expect(URL.createObjectURL).not.toHaveBeenCalled();
});
