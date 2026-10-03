import {mockNativeDialog} from "../helpers/native-dialog";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {IllustrationSettings} from "@/components/illustration-settings";
import {AuxiliaryDrawing} from "@/components/auxiliary-drawing";
import {apiClient} from "@/lib/api-client";
let host:HTMLDivElement,root:Root,restoreDialog:()=>void;
const view={revision:1,configRevision:1,providerId:"p",model:"image-01",enabled:true,providerName:"合成连接",providers:[{id:"p",name:"合成连接",baseUrl:"https://api.minimaxi.com"}]};
const base={title:"合成底图",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const plan={...base,steps:[{description:"反射点",operation:{kind:"reflect",id:"P",point:"B",a:"A",b:"C"}}]};
function deferred(){let resolve!:(value:unknown)=>void,reject!:(reason:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
beforeEach(()=>{restoreDialog=mockNativeDialog();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();restoreDialog();vi.restoreAllMocks();vi.unstubAllGlobals();});
const bar=()=>host.querySelector('[role="progressbar"]');
async function render(node:React.ReactNode){await act(async()=>root.render(node));}
async function click(text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(b).toBeTruthy();await act(async()=>b!.click());}
async function check(label:string){await act(async()=>host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click());}
async function fill(label:string,value:string){const e=host.querySelector(`[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function composer(){vi.spyOn(apiClient,'get').mockResolvedValue(view);await render(<IllustrationSettings/>);await click('读取/刷新创作配图设置');}
function indeterminate(label:string){expect(bar()).not.toBeNull();expect(bar()?.getAttribute('aria-label')).toBe(label);expect(bar()?.hasAttribute('aria-valuenow')).toBe(false);expect(host.textContent).toContain('不代表实际完成比例');}
it('does not show generation progress during settings load/save or local prompt preparation',async()=>{
 const p=deferred();vi.spyOn(apiClient,'get').mockReturnValue(p.promise);await render(<IllustrationSettings/>);await click('读取/刷新创作配图设置');expect(bar()).toBeNull();await act(async()=>p.resolve(view));
 const save=deferred();vi.spyOn(apiClient,'post').mockReturnValue(save.promise);await click('保存创作配图设置');expect(bar()).toBeNull();await act(async()=>save.resolve(view));await fill('原文或作图描述','四分之一圆');await click('整理最终提示词（不调用AI）');expect(bar()).toBeNull();
});
it.each(['success','failed'])('keeps MiniMax progress while pending and stops on %s without duplicate submission',async(outcome)=>{
 await composer();const p=deferred(),post=vi.spyOn(apiClient,'post').mockReturnValue(p.promise);await fill('原文或作图描述','半径4的四分之一圆');await click('整理最终提示词（不调用AI）');await check('确认配图收费');await click('生成1张配图');
 indeterminate('创作配图');await click('生成1张配图');expect(post).toHaveBeenCalledTimes(1);
 await act(async()=>{if(outcome==='success')p.resolve({type:'illustration',imageDataUrl:'data:image/png;base64,YQ=='});else p.reject(Error('synthetic failure'));});expect(bar()).toBeNull();
});
it.each(['success','failed'])('shows reference recognition progress only after consent and stops on %s',async(outcome)=>{
 await composer();const p=deferred(),post=vi.spyOn(apiClient,'post').mockReturnValue(p.promise);const file=host.querySelector('input[type=file]')!;
 await act(async()=>{Object.defineProperty(file,'files',{value:[new File(['synthetic'],'ref.png',{type:'image/png'})],configurable:true});file.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,30));});expect(bar()).toBeNull();expect(post).not.toHaveBeenCalled();
 await check('确认识图收费');await click('识别原图描述');indeterminate('原图识别');
 await act(async()=>{if(outcome==='success')p.resolve({type:'illustration_description',description:'圆弧',uncertainties:[]});else p.reject(Error('cancelled or failed'));});expect(bar()).toBeNull();expect(post).toHaveBeenCalledTimes(1);
});
it.each(['base','auxiliary','image_edit'])('shows and clears progress for existing drawing phase %s',async(phase)=>{
 vi.spyOn(apiClient,'get').mockResolvedValue({enabled:true,revision:1,modelName:'合成模型',providerName:'合成连接'});const post=vi.spyOn(apiClient,'post').mockResolvedValueOnce({type:'construction',plan:base}).mockResolvedValueOnce({type:'construction',plan});
 await render(<AuxiliaryDrawing questionText="合成题目" answerText="合成答案" analysis="合成解析" image="data:image/png;base64,YQ=="/>);expect(bar()).toBeNull();
 if(phase!=='base'){await click('第一步：生成原题底图');await act(async()=>host.querySelector<HTMLInputElement>('input[data-confirm-base]')!.click());}
 if(phase==='image_edit'){await click('第二步：在锁定底图上添加辅助线');await click('打开实验性AI重新配图 / 整图编辑');await act(async()=>host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!.click());}
 const p=deferred();post.mockReset().mockReturnValue(p.promise);await click(phase==='base'?'第一步：生成原题底图':phase==='auxiliary'?'第二步：在锁定底图上添加辅助线':'按构造指示生成辅助线图片');
 indeterminate(phase==='base'?'原题底图生成':phase==='auxiliary'?'辅助线方案生成':'整图编辑');await act(async()=>p.reject(Error('synthetic failure')));expect(bar()).toBeNull();expect(post).toHaveBeenCalledTimes(1);
});
