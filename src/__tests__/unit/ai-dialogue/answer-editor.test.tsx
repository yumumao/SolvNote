import {act, useState} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {ComponentProps} from "react";
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),push:vi.fn(),draw:vi.fn()}));
vi.mock("@/lib/api-client",()=>({apiClient:m}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.push})}));
vi.mock("@/components/correction-editor",()=>({CorrectionEditor:(props:ComponentProps<typeof import("@/components/correction-editor").CorrectionEditor>)=>{
 const [value,setValue]=useState(props.initialData.answerText),[drawing,setDrawing]=useState("");
 return <div data-analysis={props.initialData.analysis} data-image={props.imagePreview} data-evidence={JSON.stringify(props.drawingEvidence)}><textarea aria-label="draft" value={value} onChange={e=>{props.onDraftChange?.();setValue(e.target.value);}}/><output>{drawing}</output><button onClick={()=>props.onDraftChange?.()}>protect drawing fixture</button><button onClick={async()=>{props.onDraftChange?.();setDrawing(await m.draw(props.initialData.analysis));}}>draw fixture</button><button onClick={()=>void props.onSave({...props.initialData,answerText:value,subjectId:"owned"})}>save fixture</button></div>;
}}));
import {ConversationAnswerEditor, type AnswerSnapshot} from "@/components/conversation-answer-editor";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
let host:HTMLDivElement,root:Root,snapshot:AnswerSnapshot;
const render=async(s=snapshot)=>{await act(async()=>{root.render(<ConversationAnswerEditor id="c" snapshot={s}/>);});};
const click=async(text:string)=>{await act(async()=>{([...host.querySelectorAll("button")].find(b=>b.textContent===text) as HTMLButtonElement).click();});};
const current=()=>host.querySelector("textarea")!;
const next=(revision=4)=>({...snapshot,revision,result:{...snapshot.result,answerText:"new answer "+revision,analysis:"new steps "+revision}});
const fill=async(value:string)=>{await act(async()=>{const field=current();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(window,"confirm").mockReturnValue(true);host=document.createElement("div");document.body.append(host);root=createRoot(host);snapshot={revision:2,input:JobInputSchema.parse({questionText:"fixture",subjectId:"owned",imageBase64:"data:image/png;base64,YQ==",originalImageBase64:"data:image/png;base64,Yg=="}),result:{questionText:"q",answerText:"a",analysis:"steps",subject:"数学",knowledgePoints:["全等"],mistakeStatus:"unknown",wrongAnswerText:"",mistakeAnalysis:"",requiresImage:true}};m.post.mockResolvedValue({id:"saved"});m.draw.mockResolvedValue("old drawing");});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("latest solution takes over the main editor",()=>{
 it("immediately saves all fields with the paired original image",async()=>{
  await render();await click("save fixture");expect(m.post).toHaveBeenCalledWith("/api/error-items",expect.objectContaining({...snapshot.result,subjectId:"owned",originalImageUrl:snapshot.input.originalImageBase64}));expect(m.push).toHaveBeenCalledWith("/notebooks/owned");
 });
 it("preserves local edits on polling but archives them when a new solution takes over",async()=>{
  await render();await fill("my edit");const old=current();await render({...snapshot,revision:3});expect(current()).toBe(old);expect(old.value).toBe("my edit");
  await render(next());expect(current().value).toBe("new answer 4");expect(old.isConnected).toBe(true);expect(old.value).toBe("my edit");expect(old.closest("details")!.open).toBe(false);
  expect(host.textContent).not.toContain("采用新回复替换编辑内容");expect(m.get).not.toHaveBeenCalled();expect(window.confirm).not.toHaveBeenCalled();
 });
 it("does not let a click in the drawing area pin an old solution",async()=>{
  await render();await click("protect drawing fixture");await render(next());expect(current().value).toBe("new answer 4");
 });
 it("keeps completed drawings in the folded old editor, with an empty new drawing area",async()=>{
  await render();await click("draw fixture");const old=host.querySelector("output")!;expect(old.textContent).toBe("old drawing");await render(next());
  expect(current().value).toBe("new answer 4");expect(host.querySelector("output")!.textContent).toBe("");expect(old.isConnected).toBe(true);expect(old.closest("details")!.open).toBe(false);expect(old.textContent).toBe("old drawing");expect(m.draw).toHaveBeenCalledTimes(1);
  await click("draw fixture");expect(m.draw).toHaveBeenLastCalledWith("new steps 4");
 });
 it("isolates a late old drawing response from the new solution",async()=>{
  let finish!:(v:string)=>void;m.draw.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render();await click("draw fixture");const old=host.querySelector("output")!;
  await render(next());expect(current().value).toBe("new answer 4");await act(async()=>finish("late old drawing"));
  expect(host.querySelector("output")!.textContent).toBe("");expect(old.textContent).toBe("late old drawing");expect(old.closest("details")!.open).toBe(false);expect(m.draw).toHaveBeenCalledTimes(1);
 });
 it("a discussion-only revision keeps the same edited editor and drawing",async()=>{
  await render();await fill("custom");await click("draw fixture");const old=current();await render({...snapshot,revision:8});expect(current()).toBe(old);expect(current().value).toBe("custom");expect(host.querySelector("output")!.textContent).toBe("old drawing");
 });
 it("pairs the new image, analysis and evidence when drawing and saving",async()=>{
  await render();const fresh={...next(),input:{...snapshot.input,originalImageBase64:"data:image/png;base64,Yw=="},geometryChecked:true,transcript:{text:"new source",facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[],angles:[{label:"1",vertex:"B",arms:["A","C"] as [string,string]}]}}};await render(fresh);
  const data=current().parentElement!;expect(data.dataset.image).toBe(fresh.input.originalImageBase64);expect(JSON.parse(data.dataset.evidence!)).toMatchObject({authority:"verified",angles:fresh.transcript.geometry.angles});
  await click("draw fixture");expect(m.draw).toHaveBeenCalledWith(fresh.result.analysis);await click("save fixture");expect(m.post).toHaveBeenCalledWith("/api/error-items",expect.objectContaining({analysis:fresh.result.analysis,originalImageUrl:fresh.input.originalImageBase64}));
 });
 it("updates evidence-only snapshots without mixing previous evidence",async()=>{
  snapshot={...snapshot,transcript:{text:"source",facts:[],uncertainties:[],missingInformation:[]}};await render();await click("protect drawing fixture");await render({...snapshot,revision:5,transcriptClarifications:["角1在顶点A"]});expect(current().parentElement!.dataset.evidence).toContain("角1在顶点A");
 });
 it("ignores stale revisions even after editing",async()=>{
  await render(next(8));await fill("custom latest");await render(snapshot);expect(current().value).toBe("custom latest");
 });
 it("consecutive new answers always take over and preserve distinct old drafts",async()=>{
  await render();await fill("old1");await render(next());await fill("old2");await render(next(6));expect([...host.querySelectorAll("textarea")].map(t=>t.value)).toEqual(["new answer 6","old2","old1"]);
  expect([...host.querySelectorAll("textarea")].slice(1).every(t=>!t.closest("details")!.open)).toBe(true);
 });
 it("new answer can take over during a previous save without a stale navigation",async()=>{
  let finish!:(v:unknown)=>void;m.post.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render();await click("save fixture");await render(next());expect(current().value).toBe("new answer 4");await act(async()=>finish({id:"saved"}));expect(m.push).not.toHaveBeenCalled();expect(host.textContent).toContain("旧题解已保存");
 });
 it("failed saves retain the draft and never disclose the underlying exception",async()=>{
  m.post.mockRejectedValueOnce(new Error("private upstream"));await render();await click("save fixture");expect(m.push).not.toHaveBeenCalled();expect(host.textContent).toContain("未确认保存成功");expect(host.textContent).not.toContain("private upstream");
 });
 it("archived editors cannot submit extra saves or drawings",async()=>{
  await render();await render(next());const old=host.querySelectorAll("textarea")[1];expect(old.closest("fieldset")!.disabled).toBe(true);
 });
 it("explains manual redraw and does not trigger any AI when adopting the new solution",async()=>{
  await render();await render(next());expect(host.textContent).toContain("手动重绘");expect(m.draw).not.toHaveBeenCalled();expect(m.post).not.toHaveBeenCalled();
 });
});
