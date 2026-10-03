import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing,DrawingResultPreview} from "@/components/auxiliary-drawing";
import {apiClient} from "@/lib/api-client";
const source="data:image/png;base64,YQ==";
const base={title:"Locked square",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const steps=[{description:"Reflect B",operation:{kind:"reflect",id:"P",point:"B",a:"A",b:"C"}}];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");root=createRoot(host);vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
const props={questionText:"Source question",answerText:"Answer",analysis:"Proof",drawingCorrection:"",image:source};
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;
async function render(override={}){await act(async()=>root.render(<AuxiliaryDrawing {...props} {...override}/>));}
async function click(text:string){expect(button(text)).toBeDefined();await act(async()=>button(text).click());}
async function confirmBase(){const check=host.querySelector('input[data-confirm-base]') as HTMLInputElement;expect(check).not.toBeNull();await act(async()=>check.click());}
describe("separate base confirmation and auxiliary requests",()=>{
 it("makes one source-only job, waits for confirmation, then sends the same base snapshot",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockResolvedValueOnce({type:"construction",plan:{...base,steps}});
  await render();await click("第一步：生成原题底图");
  expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0][1]).toEqual({questionText:props.questionText,answerText:props.answerText,analysis:props.analysis,drawingCorrection:"",imageBase64:source});
  const original=host.querySelector('[data-layer="base"]')!.outerHTML;
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
  await confirmBase();await click("第二步：在锁定底图上添加辅助线");
  expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1][1]).toMatchObject({questionText:props.questionText,answerText:props.answerText,analysis:props.analysis,drawingPlan:base});
  expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(original);
 });
 it("invalidates only auxiliary results for changed answers and requires a new base for changed questions",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan:base});
  await render();await click("第一步：生成原题底图");await confirmBase();
  await render({answerText:"New answer"});expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(false);expect(post).toHaveBeenCalledTimes(1);
  await render({questionText:"Different source"});expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);expect(host.textContent).toContain("原题、原图或底图纠正说明已修改");
 });
 it("allows a correction note to regenerate only the source stage",async()=>{
  const corrected={...base,title:"Corrected source"};
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockResolvedValueOnce({type:"construction",plan:corrected});
  await render();await click("第一步：生成原题底图");
  const textarea=host.querySelector('textarea[data-drawing-correction]') as HTMLTextAreaElement;
  const setValue=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!;
  await act(async()=>{setValue.call(textarea,"A应在左上角，AB保持竖直，不要旋转原图。");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
  expect(button("根据纠正说明重新生成原题底图").disabled).toBe(false);
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
  await click("根据纠正说明重新生成原题底图");
  expect(post.mock.calls[1][1]).toMatchObject({questionText:props.questionText,answerText:props.answerText,analysis:props.analysis,drawingCorrection:"A应在左上角，AB保持竖直，不要旋转原图。",imageBase64:source});
  expect(post.mock.calls[1][1]).not.toHaveProperty("drawingPlan");
  expect(host.querySelector('input[data-confirm-base]')).not.toBeNull();
  expect((host.querySelector('input[data-confirm-base]') as HTMLInputElement).checked).toBe(false);
 }); it("keeps the frozen source visible on auxiliary failure without restarting the first stage",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockRejectedValueOnce(new Error("synthetic failure"));
  await render();await click("第一步：生成原题底图");await confirmBase();const original=host.querySelector('[data-layer="base"]')!.outerHTML;
  await click("第二步：在锁定底图上添加辅助线");expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(original);expect(post).toHaveBeenCalledTimes(2);
 });
 it("preserves the old source after failed correction, then clears auxiliary steps on successful redraw",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockResolvedValueOnce({type:"construction",plan:{...base,steps}}).mockRejectedValueOnce(new Error("synthetic redraw failure")).mockResolvedValueOnce({type:"construction",plan:{...base,title:"Corrected source"}});
  await render();await click("第一步：生成原题底图");await confirmBase();await click("第二步：在锁定底图上添加辅助线");
  const original=host.querySelector('[data-layer="base"]')!.outerHTML;
  expect(host.querySelector('[data-aux-point="P"]')).not.toBeNull();
  const textarea=host.querySelector('textarea[data-drawing-correction]') as HTMLTextAreaElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"A应在左上角");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
  expect(post).toHaveBeenCalledTimes(2);
  await click("根据纠正说明重新生成原题底图");
  expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(original);
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
  await click("根据纠正说明重新生成原题底图");
  expect(host.querySelector('[data-aux-point="P"]')).toBeNull();
  expect((host.querySelector('[data-confirm-base]') as HTMLInputElement).checked).toBe(false);
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
  expect(post.mock.calls[3][1]).not.toHaveProperty("drawingPlan");
 });
 it("restores a completed base without calling AI and lets the owner continue explicitly",async()=>{
  const post=vi.spyOn(apiClient,"post");
  await act(async()=>root.render(<DrawingResultPreview result={{type:"construction",plan:base}} originalImage={source} input={props}/>));
  expect(host.querySelector('[data-layer="base"]')).not.toBeNull();expect(button("第二步：在锁定底图上添加辅助线")).toBeDefined();expect(post).not.toHaveBeenCalled();
 });

 it("keeps correction editable before the first diagram without submitting a request",async()=>{
  const post=vi.spyOn(apiClient,"post");await render();
  const textarea=host.querySelector('textarea[data-drawing-correction]') as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();expect(textarea.disabled).toBe(false);
  expect(host.querySelector('svg[role="img"]')).toBeNull();expect(post).not.toHaveBeenCalled();
 });
 it("keeps both diagrams in a top-to-bottom workflow with correction between the stages",async()=>{
  const post=vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockResolvedValueOnce({type:"construction",plan:{...base,steps}});
  await render();await click("第一步：生成原题底图");
  const before=(a:Element,b:Element)=>expect(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const baseStage=host.querySelector('[data-drawing-stage="base"]')!;
  expect(baseStage).not.toBeNull();
  const diagram=baseStage.querySelector('svg[role="img"]')!;
  const note=host.querySelector('textarea[data-drawing-correction]')!;
  const original=diagram.outerHTML;
  const assertPosition=()=>{
   before(button("第一步：生成原题底图"),diagram);before(diagram,note);
   before(note,host.querySelector('[data-confirm-base]')!);
   before(host.querySelector('[data-confirm-base]')!,button("第二步：在锁定底图上添加辅助线"));
  };
  assertPosition();await confirmBase();await click("第二步：在锁定底图上添加辅助线");assertPosition();
  const auxiliary=host.querySelector('[data-drawing-stage="auxiliary"]')!;
  const result=auxiliary.querySelector('svg[role="img"]')!;
  expect(host.querySelectorAll('svg[role="img"]')).toHaveLength(2);
  expect(baseStage.querySelector('svg[role="img"]')).toBe(diagram);
  expect(diagram.outerHTML).toBe(original);expect(baseStage.querySelector('[data-aux-point="P"]')).toBeNull();
  expect(auxiliary.querySelector('[data-aux-point="P"]')).not.toBeNull();
  before(button("第二步：在锁定底图上添加辅助线"),result);
  before(result,button("打开实验性AI重新配图 / 整图编辑"));
  const previous=[...auxiliary.querySelectorAll('button')].find(b=>b.textContent==="上一步")!;
  await act(async()=>previous.click());
  expect(auxiliary.querySelector('[data-aux-point="P"]')).toBeNull();expect(diagram.outerHTML).toBe(original);
  expect(post).toHaveBeenCalledTimes(2);
 });
 it("places a recovered base correction below its diagram without regenerating it",async()=>{
  const post=vi.spyOn(apiClient,"post");
  await act(async()=>root.render(<DrawingResultPreview result={{type:"construction",plan:base}} originalImage={source} input={{...props,drawingCorrection:"Keep A above B"}}/>));
  const diagram=host.querySelector('svg[role="img"]')!;
  const note=host.querySelector('textarea[data-drawing-correction]') as HTMLTextAreaElement;
  expect(note.value).toBe("Keep A above B");
  expect(note.compareDocumentPosition(button("第二步：在锁定底图上添加辅助线"))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(diagram.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
 });

 it("keeps waiting feedback under the active stage button and retains the base while waiting",async()=>{
  let finish!:(value:unknown)=>void;
  const post=vi.spyOn(apiClient,"post").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await render();await click("第一步：生成原题底图");
  const baseStage=host.querySelector('[data-drawing-stage="base"]')!;
  expect(baseStage).not.toBeNull();
  expect(baseStage.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async()=>finish({type:"construction",plan:base}));
  expect(host.querySelector('[role="progressbar"]')).toBeNull();await confirmBase();
  const original=baseStage.querySelector('svg[role="img"]')!.outerHTML;
  await click("第二步：在锁定底图上添加辅助线");
  const auxiliary=host.querySelector('[data-drawing-stage="auxiliary"]')!;
  expect(auxiliary.querySelector('[role="progressbar"]')).not.toBeNull();
  expect(baseStage.querySelector('[role="progressbar"]')).toBeNull();
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(baseStage.querySelector('svg[role="img"]')!.outerHTML).toBe(original);
  await act(async()=>finish({type:"construction",plan:{...base,steps}}));
  expect(host.querySelector('[role="progressbar"]')).toBeNull();expect(post).toHaveBeenCalledTimes(2);
 });
 it("hides only the lower result when the answer changes and keeps the upper source diagram",async()=>{
  vi.spyOn(apiClient,"post").mockResolvedValueOnce({type:"construction",plan:base}).mockResolvedValueOnce({type:"construction",plan:{...base,steps}});
  await render();await click("第一步：生成原题底图");await confirmBase();await click("第二步：在锁定底图上添加辅助线");
  const diagram=host.querySelector('[data-drawing-stage="base"] svg[role="img"]');
  expect(diagram).not.toBeNull();await render({answerText:"New answer"});
  expect(host.querySelector('[data-drawing-stage="base"] svg[role="img"]')).toBe(diagram);
  expect(host.querySelector('[data-drawing-stage="auxiliary"] svg[role="img"]')).toBeNull();
  expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(false);
 });
});
