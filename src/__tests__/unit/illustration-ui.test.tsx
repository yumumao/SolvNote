import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {AIDrawingSettings} from "@/components/ai-drawing-settings";
import {IllustrationSettings,IllustrationPreview} from "@/components/illustration-settings";
import {apiClient} from "@/lib/api-client";
const view={revision:1,configRevision:3,providerId:"p",model:"image-01",enabled:true,providerName:"MiniMax",providers:[{id:"p",name:"MiniMax",baseUrl:"https://api.minimax.cn/v1"}]};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()});
const render=async(e:React.ReactNode)=>{await act(async()=>root.render(e))};
const click=async(label:string)=>{const b=[...host.querySelectorAll("button")].find(b=>b.textContent===label);expect(b).toBeTruthy();await act(async()=>b!.click())};
describe("image settings separation",()=>{
 it("documents minimaxi.com and explains URL filtering when the saved provider list is empty",async()=>{
  vi.spyOn(apiClient,"get").mockResolvedValue({...view,providerId:null,providerName:null,enabled:false,providers:[]});
  await render(<IllustrationSettings/>);expect(host.textContent).toContain("https://api.minimaxi.com");await click("读取/刷新创作配图设置");
  expect(host.textContent).toContain("请同时核对API基础地址是否在上述支持列表内");expect(host.querySelector('[aria-label="MiniMax配图连接"]')?.querySelectorAll("option")).toHaveLength(1);
 });
 it("makes no paid request on render and explains Gemini is optional",async()=>{const post=vi.spyOn(apiClient,"post");await render(<AIDrawingSettings/>);expect(host.textContent).toContain("可选图片生成与辅助作图");expect(host.textContent).toContain("无需Gemini");expect(host.textContent).toContain("创作配图");expect(post).not.toHaveBeenCalled()});
 it("requires settings load, typed prompt and explicit consent before submission",async()=>{
  vi.spyOn(apiClient,"get").mockResolvedValue(view);const post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"illustration",imageDataUrl:"data:image/png;base64,YQ==",modelName:"image-01",providerName:"MiniMax"});
  await render(<IllustrationSettings/>);await click("读取/刷新创作配图设置");const b=[...host.querySelectorAll("button")].find(b=>b.textContent==="生成1张配图")!;expect(b.disabled).toBe(true);
  const ta=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(ta,"合成描述");ta.dispatchEvent(new Event("input",{bubbles:true}))});expect(b.disabled).toBe(true);
  await click("整理最终提示词（不调用AI）");
  await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="确认配图收费"]')!.click());await click("生成1张配图");
  expect(post).toHaveBeenCalledWith("/api/ai/drawing/illustration",expect.objectContaining({questionText:expect.stringContaining("合成描述"),confirmIllustration:true,illustrationRevision:1}),expect.any(Object));expect(host.querySelector("a[download]")).not.toBeNull();
 });
 it("rejects remote URLs in restored media results and never fetches them",async()=>{await render(<IllustrationPreview result={{type:"illustration",imageDataUrl:"https://example.org/a.png"}}/>);expect(host.querySelector("img")).toBeNull();expect(host.textContent).toContain("无效")});
});

it('changed model disables generation until saved and consent is reset after one generation',async()=>{
 vi.spyOn(apiClient,'get').mockResolvedValue(view);const post=vi.spyOn(apiClient,'post').mockResolvedValue({type:'illustration',imageDataUrl:'data:image/png;base64,YQ=='});
 await render(<IllustrationSettings/>);await click('读取/刷新创作配图设置');const ta=host.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(ta,'synthetic');ta.dispatchEvent(new Event('input',{bubbles:true}))});
 await click('整理最终提示词（不调用AI）');
 await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="确认配图收费"]')!.click());
 await act(async()=>{const model=host.querySelector<HTMLSelectElement>('[aria-label="MiniMax配图模型"]')!;model.value='image-01-live';model.dispatchEvent(new Event('change',{bubbles:true}))});
 const b=[...host.querySelectorAll('button')].find(b=>b.textContent==='生成1张配图')!;expect(b.disabled).toBe(true);expect(post).not.toHaveBeenCalled();
 await click('读取/刷新创作配图设置');await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="确认配图收费"]')!.click());
 await act(async()=>{b.click();b.click()});expect(post).toHaveBeenCalledTimes(1);expect(b.disabled).toBe(true);
});
