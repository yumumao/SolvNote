import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing} from "@/components/auxiliary-drawing";
import {apiClient} from "@/lib/api-client";
import type {ConstructionPlan} from "@/lib/ai-drawing/construction";
const base:ConstructionPlan={title:"Synthetic base",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const corrected={...base,points:[{id:"A",x:4,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}]};
const props={questionText:"Synthetic triangle",answerText:"Answer",analysis:"Proof",image:"data:image/png;base64,YQ=="};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");root=createRoot(host);vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===label)!;
const regenerate=()=>button("根据纠正说明重新生成原题底图");
async function render(extra={}){await act(async()=>root.render(<AuxiliaryDrawing {...props} initialBase={base} {...extra}/>));}
async function click(b:HTMLButtonElement){expect(b).toBeDefined();await act(async()=>b.click());}
async function correct(value="A应移到右上角，B、C不动"){
 const field=host.querySelector("textarea[data-drawing-correction]")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});
}
const svg=()=>host.querySelector('[data-drawing-stage="base"] [data-layer="base"]')!.outerHTML;
describe("base regeneration is a new first-stage job",()=>{
 it("sends the editable previous base and replaces actual SVG points, not just the caption",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan:corrected});
  await render();const before=svg();await correct();await click(regenerate());
  expect(post.mock.calls[0][1]).toMatchObject({drawingPreviousBase:base,drawingCorrection:"A应移到右上角，B、C不动"});
  expect(post.mock.calls[0][1]).not.toHaveProperty("drawingPlan");
  expect(svg()).not.toBe(before);expect((host.querySelector("input[data-confirm-base]") as HTMLInputElement).checked).toBe(false);
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);expect(post).toHaveBeenCalledTimes(1);
 });
 it("keeps progress and task feedback immediately below the lower correction button through acceptance",async()=>{
  let finish!:(v:unknown)=>void;const post=vi.spyOn(apiClient,"post").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await render();const before=svg();await correct();await click(regenerate());
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  const progress=host.querySelector('[role="progressbar"]')!;
  expect(regenerate().compareDocumentPosition(progress)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(regenerate().disabled).toBe(true);expect(svg()).toBe(before);
  await act(async()=>post.mock.calls[0][2]?.onJobAccepted?.("synthetic-regeneration"));
  expect(regenerate().compareDocumentPosition(host.querySelector('a[href*="synthetic-regeneration"]')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async()=>finish({type:"construction",plan:corrected}));expect(host.querySelector('[role="progressbar"]')).toBeNull();
 });
 it("warns when only title/notes changed and leaves an explicit retry without automatic paid resubmission",async()=>{
  const same={...base,title:"Changed explanation only",points:[...base.points].reverse(),segments:[["C","B"],["B","A"]],circles:[],arcs:[],notes:[{text:"A应在右上方",status:"confirmed"}]};
  const post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan:same});
  await render();await correct();await click(regenerate());
  expect(host.textContent).toContain("绘图内容与上一版相同");expect(regenerate()).toBeDefined();expect(regenerate().disabled).toBe(false);
  expect((host.querySelector("input[data-confirm-base]") as HTMLInputElement).checked).toBe(false);expect(post).toHaveBeenCalledTimes(1);
  await click(regenerate());expect(post).toHaveBeenCalledTimes(2);
 });
 it("retains the old base after failure, ends progress and leaves correction retry available",async()=>{
  vi.spyOn(apiClient,"post").mockRejectedValue(Error("synthetic failure"));await render();const before=svg();await correct();await click(regenerate());
  expect(svg()).toBe(before);expect(host.querySelector('[role="progressbar"]')).toBeNull();expect(regenerate().disabled).toBe(false);expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
 });
 it("does not mark an in-flight correction as covering newer typed corrections",async()=>{
  let finish!:(v:unknown)=>void;vi.spyOn(apiClient,"post").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await render();await correct();await click(regenerate());await correct("C也需移到左侧");await act(async()=>finish({type:"construction",plan:corrected}));
  expect(host.textContent).toContain("底图属于旧版本");expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);expect(regenerate().disabled).toBe(false);
 });
 it("detects actual point or in-diagram label changes without an unchanged warning",async()=>{
  vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan:{...base,annotations:[{kind:"segment",a:"A",b:"B",text:"4"}]}});
  await render();await correct("AB标为4");await click(regenerate());expect(host.querySelector('[data-diagram-annotation="segment"]')?.textContent).toBe("4");expect(host.textContent).not.toContain("绘图内容与上一版相同");
 });
});