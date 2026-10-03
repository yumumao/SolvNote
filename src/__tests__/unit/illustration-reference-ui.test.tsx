import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {IllustrationSettings} from "@/components/illustration-settings";
import {apiClient} from "@/lib/api-client";
let host:HTMLDivElement,root:Root;
const view={revision:1,configRevision:3,providerId:"p",model:"image-01",enabled:true,providerName:"MiniMax",providers:[{id:"p",name:"MiniMax",baseUrl:"https://api.minimaxi.com/v1"}]};
beforeEach(async()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.spyOn(apiClient,"get").mockResolvedValue(view);await act(async()=>root.render(<IllustrationSettings/>));await click("读取/刷新创作配图设置")});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()});
const button=(s:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===s)!;
async function click(s:string){expect(button(s)).toBeTruthy();await act(async()=>button(s).click())}
async function fill(label:string,value:string){const el=host.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`);expect(el).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(el,value);el!.dispatchEvent(new Event("input",{bubbles:true}))})}
async function check(label:string){const e=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);expect(e).toBeTruthy();await act(async()=>e!.click())}
const result={type:"illustration",imageDataUrl:"data:image/png;base64,YQ==",modelName:"image-01",providerName:"MiniMax"};
it("builds an inspectable default prompt without AI and sends the exact final edit only after consent",async()=>{
 const post=vi.spyOn(apiClient,"post").mockResolvedValue(result);
 await fill("原文或作图描述","半径为4的四分之一圆");await fill("补充作图要求","不要画正方形");
 await click("整理最终提示词（不调用AI）");const final=host.querySelector<HTMLTextAreaElement>('[aria-label="最终配图提示词"]')!;
 expect(final.value).toContain("半径为4");expect(final.value).toContain("不要画正方形");expect(post).not.toHaveBeenCalled();expect(button("生成1张配图").disabled).toBe(true);
 await fill("最终配图提示词",final.value+"\n人工修订");const exact=final.value;await check("确认配图收费");await click("生成1张配图");
 expect(post).toHaveBeenCalledTimes(1);expect(post).toHaveBeenCalledWith("/api/ai/drawing/illustration",expect.objectContaining({questionText:exact}),expect.anything());
});
it("reuses a pasted description only after verification and invalidates final prompt when sources change",async()=>{
 const post=vi.spyOn(apiClient,"post");await fill("原文或作图描述","合成原文");await fill("原图描述（可编辑）","已识别圆弧OA与OB");
 expect(button("整理最终提示词（不调用AI）").disabled).toBe(true);await check("确认原图描述");await click("整理最终提示词（不调用AI）");await check("确认配图收费");expect(button("生成1张配图").disabled).toBe(false);
 await fill("补充作图要求","保留原有朝向");expect(button("生成1张配图").disabled).toBe(true);expect(host.textContent).toContain("已失效");expect(post).not.toHaveBeenCalled();
});
it("keeps overlength final text visible but disables paid dispatch instead of truncating conditions",async()=>{
 const post=vi.spyOn(apiClient,"post");await fill("原文或作图描述","条件".repeat(800));await click("整理最终提示词（不调用AI）");
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="最终配图提示词"]')!.value.length).toBeGreaterThan(1500);expect(host.textContent).toContain("不会自动截断");expect(button("生成1张配图").disabled).toBe(true);expect(post).not.toHaveBeenCalled();
});
it("uploads locally, describes once with separate consent, never auto-generates, and clears old facts on replacement",async()=>{
 const post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"illustration_description",description:"圆弧和两条半径",uncertainties:["长度字迹不清"]});
 const file=host.querySelector<HTMLInputElement>('input[type=file]');expect(file).toBeTruthy();
 await act(async()=>{Object.defineProperty(file,"files",{value:[new File(["synthetic"],"ref.png",{type:"image/png"})],configurable:true});file!.dispatchEvent(new Event("change",{bubbles:true}));await new Promise(r=>setTimeout(r,30))});
 expect(post).not.toHaveBeenCalled();expect(button("识别原图描述").disabled).toBe(true);await check("确认识图收费");await act(async()=>{button("识别原图描述").click();button("识别原图描述").click()});
 expect(post).toHaveBeenCalledTimes(1);expect(post).toHaveBeenCalledWith("/api/ai/drawing/illustration_describe",expect.objectContaining({confirmDescription:true,imageBase64:expect.stringContaining("data:image/png;base64,")}),expect.anything());
 expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原图描述（可编辑）"]')!.value).toBe("圆弧和两条半径");expect(host.textContent).toContain("长度字迹不清");expect(button("整理最终提示词（不调用AI）").disabled).toBe(true);
 await click("移除原图");expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原图描述（可编辑）"]')!.value).toBe("");expect(post).toHaveBeenCalledTimes(1);
});

it("edits invalidate consent and edited descriptions require a fresh review",async()=>{
 await fill("原图描述（可编辑）","已核对圆心O");await check("确认原图描述");await click("整理最终提示词（不调用AI）");await check("确认配图收费");
 await fill("最终配图提示词","新的最终文字");expect(button("生成1张配图").disabled).toBe(true);await check("确认配图收费");expect(button("生成1张配图").disabled).toBe(false);
 await fill("原图描述（可编辑）","修订圆心O");expect(host.querySelector<HTMLInputElement>('[aria-label="确认原图描述"]')!.checked).toBe(false);expect(button("整理最终提示词（不调用AI）").disabled).toBe(true);expect(button("生成1张配图").disabled).toBe(true);
});
it("allows manual shortening without silently discarding conditions",async()=>{
 const post=vi.spyOn(apiClient,"post").mockResolvedValue(result);await fill("原文或作图描述","条件".repeat(800));await click("整理最终提示词（不调用AI）");await fill("最终配图提示词","人工精简：半径4，90度扇形。");await check("确认配图收费");await click("生成1张配图");expect(post).toHaveBeenCalledWith("/api/ai/drawing/illustration",expect.objectContaining({questionText:"人工精简：半径4，90度扇形。"}),expect.anything());
});
