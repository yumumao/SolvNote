import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {mockNativeDialog} from "../helpers/native-dialog";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing,ConstructionPreview} from "@/components/auxiliary-drawing";
import {apiClient} from "@/lib/api-client";
const image="data:image/png;base64,YQ==";
const plan:import("@/lib/ai-drawing/construction").ConstructionPlan={title:"合成底图",points:[{id:"A",x:0,y:0},{id:"B",x:4,y:0}],segments:[["A","B"]],steps:[]};
let host:HTMLDivElement,root:Root,restore:()=>void;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);restore=mockNativeDialog();host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.spyOn(apiClient,"get").mockResolvedValue({enabled:true,revision:1,providerName:"合成",model:"image-01"});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();restore();vi.restoreAllMocks();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===label)!;
async function click(label:string){expect(button(label),label).toBeTruthy();await act(async()=>button(label).click());}
async function check(label:string){await act(async()=>host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click());}
async function fill(label:string,value:string){const el=host.querySelector(`[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));});}
const dialog=()=>host.querySelector<HTMLDialogElement>("dialog")!;
const open=()=>click("打开实验性AI重新配图 / 整图编辑");
async function render(withImage=false){await act(async()=>root.render(<AuxiliaryDrawing questionText="合成四分之一圆" answerText="合成答案" analysis="合成解析" image={withImage?image:undefined}/>));}
async function load(withImage=false){await render(withImage);await open();await click("载入当前题目并读取MiniMax设置");}
it("collapses the original by default and keeps the local diagram available",async()=>{
 await act(async()=>root.render(<ConstructionPreview plan={plan} originalImage={image}/>));const details=host.querySelector<HTMLDetailsElement>("details");expect(details).not.toBeNull();expect(details!.open).toBe(false);expect(details!.querySelector("summary")?.textContent).toContain("原题图对照");expect(details!.querySelector("img")).not.toBeNull();expect(host.querySelector('svg[role="img"]')).not.toBeNull();await act(async()=>details!.querySelector("summary")!.click());expect(details!.open).toBe(true);await act(async()=>details!.querySelector("summary")!.click());expect(details!.open).toBe(false);
});
it("omits original comparison for absent or unsafe image URLs",async()=>{for(const originalImage of [undefined,"https://invalid.example/image.png"]){await act(async()=>root.render(<ConstructionPreview plan={plan} originalImage={originalImage}/>));expect(host.querySelector("details")).toBeNull();expect(host.querySelector("img")).toBeNull();}});
it("opens an accessible modal on request with a separate scroll area and fixed close control",async()=>{
 await render();expect(dialog()).not.toBeNull();expect(dialog().open).toBe(false);expect(apiClient.get).not.toHaveBeenCalled();await open();expect(dialog().open).toBe(true);expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toContain("实验性AI");const close=button("关闭弹窗");expect(close.closest("[data-drawing-dialog-scroll]")).toBeNull();expect(dialog().querySelector("[data-drawing-dialog-scroll]")).not.toBeNull();await click("关闭弹窗");expect(dialog().open).toBe(false);
});
it("retains the edited draft and confirmations after close and reopen without reloading",async()=>{
 await load();await fill("原文或作图描述","人工草稿不丢失");await click("整理最终提示词（不调用AI）");await check("确认配图收费");const field=host.querySelector<HTMLTextAreaElement>('[aria-label="原文或作图描述"]')!;await click("关闭弹窗");await open();expect(field.isConnected).toBe(true);expect(field.value).toBe("人工草稿不丢失");expect(host.querySelector<HTMLInputElement>('[aria-label="确认配图收费"]')!.checked).toBe(true);expect(vi.mocked(apiClient.get).mock.calls.filter(([url])=>url.includes("illustration-settings"))).toHaveLength(1);
});
it.each(["illustration","illustration_describe"])("closing while %s is pending preserves request, progress and result without retry",async kind=>{
 let resolve!:(v:unknown)=>void;const pending=new Promise(r=>{resolve=r;});let signal:AbortSignal|undefined;
 const post=vi.spyOn(apiClient,"post").mockImplementation((_url,_body,options)=>{signal=options?.signal??undefined;return pending;});await load(kind==="illustration_describe");
 if(kind==="illustration"){await click("整理最终提示词（不调用AI）");await check("确认配图收费");await click("生成1张配图");}else{await check("确认识图收费");await click("识别原图描述");}
 expect(dialog().querySelector('[role="progressbar"]')).not.toBeNull();await click("关闭弹窗");expect(signal?.aborted).toBe(false);await open();expect(post).toHaveBeenCalledTimes(1);expect(dialog().querySelector('[role="progressbar"]')).not.toBeNull();await click("关闭弹窗");
 await act(async()=>resolve(kind==="illustration"?{type:"illustration",imageDataUrl:image}:{type:"illustration_description",description:"后台返回合成描述",uncertainties:[]}));await open();expect(post).toHaveBeenCalledTimes(1);expect(dialog().querySelector('[role="progressbar"]')).toBeNull();
 if(kind==="illustration")expect(dialog().querySelector('a[download="solvnote-illustration.png"]')).not.toBeNull();else expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原图描述（可编辑）"]')!.value).toContain("后台返回合成描述");
});
it("handles Escape/cancel without losing mounted fields",async()=>{await load();const field=host.querySelector('[aria-label="原文或作图描述"]');await act(async()=>dialog().dispatchEvent(new Event("cancel",{cancelable:true})));expect(dialog().open).toBe(false);await open();expect(host.querySelector('[aria-label="原文或作图描述"]')).toBe(field);});

it("keeps completed local geometry status outside the Gemini panel",async()=>{
 vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan});vi.spyOn(window,"confirm").mockReturnValue(true);await render();await click("第一步：生成原题底图");expect(host.textContent).toContain("原题底图已生成。");await open();expect(dialog().textContent).not.toContain("原题底图已生成。");
});

it("owns Escape ahead of the parent modal and removes the handler when closed",async()=>{
 await load();const outer=vi.fn();document.addEventListener("keydown",outer,true);
 try{const field=dialog().querySelector('[aria-label="原文或作图描述"]')!;await act(async()=>field.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));expect(dialog().open).toBe(false);expect(outer).not.toHaveBeenCalled();await act(async()=>document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(outer).toHaveBeenCalledTimes(1);await open();expect(dialog().querySelector('[aria-label="原文或作图描述"]')).toBe(field);}finally{document.removeEventListener("keydown",outer,true);}
});
