// Synthetic audit: exercises the full correction -> relock -> auxiliary UI sequence.
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing} from "@/components/auxiliary-drawing";
import {ApiError,apiClient} from "@/lib/api-client";
import type {ConstructionPlan} from "@/lib/ai-drawing/construction";
const base:ConstructionPlan={title:"Synthetic base",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const corrected:ConstructionPlan={...base,points:[{id:"A",x:4,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}]};
const props={questionText:"Synthetic source",answerText:"Connect A to C",analysis:"Synthetic proof"};
const steps:ConstructionPlan["steps"]=[{description:"Connect A to C",operation:{kind:"segment",a:"A",b:"C"}}];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");root=createRoot(host);vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===text)!;
const second=()=>button("第二步：在锁定底图上添加辅助线");
async function render(){await act(async()=>root.render(<AuxiliaryDrawing {...props} initialBase={base}/>));}
async function correct(){
 const field=host.querySelector("textarea[data-drawing-correction]")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"A应移到右上方");field.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>button("根据纠正说明重新生成原题底图").click());
}
async function relock(){await act(async()=>(host.querySelector("input[data-confirm-base]") as HTMLInputElement).click());}
const svg=()=>host.querySelector('[data-drawing-stage="base"] [data-layer="base"]')!.outerHTML;
describe("corrected-base UI handoff audit",()=>{
 it("submits the new base after relocking, with no editable previous-base field leaking into stage two",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:corrected}).mockResolvedValueOnce({type:"construction",plan:{...corrected,steps}});
  await render();const old=svg();await correct();expect(svg()).not.toBe(old);const locked=svg();
  expect(second().disabled).toBe(true);await relock();expect(second().disabled).toBe(false);
  await act(async()=>second().click());
  expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1][1]).toMatchObject({...props,drawingPlan:corrected});
  expect(post.mock.calls[1][1]).not.toHaveProperty("drawingPreviousBase");expect(svg()).toBe(locked);
  expect(host.querySelector('[data-drawing-stage="auxiliary"] [data-layer="base"]')!.outerHTML).toBe(locked);
 });
 it("retains the corrected base and stops progress on unsupported without automatically resending either stage",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:corrected}).mockRejectedValueOnce(new ApiError(422,"AI task stopped",{message:"AI_DRAWING_UNSUPPORTED",diagnostic:"DRAWING_UNSUPPORTED"}));
  await render();await correct();await relock();const locked=svg();await act(async()=>second().click());
  expect(post).toHaveBeenCalledTimes(2);expect(svg()).toBe(locked);expect(host.querySelector('[role="progressbar"]')).toBeNull();
  expect(host.textContent).toContain("白名单");expect(host.textContent).toContain("未自动换模型重试");
  expect(host.querySelector('[data-drawing-stage="auxiliary"] [data-layer="base"]')).toBeNull();
 });
});
