import {act, useState} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {ComponentProps} from "react";
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),push:vi.fn(),editor:null as unknown}));
vi.mock("@/lib/api-client",()=>({apiClient:m}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.push})}));
vi.mock("@/components/correction-editor",()=>({CorrectionEditor:(props:ComponentProps<typeof import("@/components/correction-editor").CorrectionEditor>)=>{
 m.editor=props;const [value,setValue]=useState(props.initialData.answerText);
 return <div><textarea aria-label="draft" value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>void props.onSave({...props.initialData,answerText:value,subjectId:"owned"})}>save fixture</button></div>;
}}));
import {ConversationAnswerEditor, type AnswerSnapshot} from "@/components/conversation-answer-editor";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
let host:HTMLDivElement,root:Root,snapshot:AnswerSnapshot;
const render=async(s=snapshot)=>{await act(async()=>{root.render(<ConversationAnswerEditor id="c" snapshot={s}/>);});};
const click=async(text:string)=>{await act(async()=>{([...host.querySelectorAll("button")].find(b=>b.textContent===text) as HTMLButtonElement).click();});};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(window,"confirm").mockReturnValue(true);host=document.createElement("div");document.body.append(host);root=createRoot(host);snapshot={revision:2,input:JobInputSchema.parse({questionText:"fixture",subjectId:"owned",imageBase64:"data:image/png;base64,YQ==",originalImageBase64:"data:image/png;base64,Yg=="}),result:{questionText:"q",answerText:"a",analysis:"steps",subject:"数学",knowledgePoints:["全等"],mistakeStatus:"unknown",wrongAnswerText:"",mistakeAnalysis:"",requiresImage:true}};m.get.mockResolvedValue({id:"c",state:"answered",...snapshot});m.post.mockResolvedValue({id:"saved"});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("inline notebook draft",()=>{
 it("immediately edits and saves all fields with the paired original image without a retrieval click",async()=>{
  await render();expect(host.querySelector("textarea")).not.toBeNull();expect(m.post).not.toHaveBeenCalled();await click("save fixture");
  expect(m.post).toHaveBeenCalledWith("/api/error-items",expect.objectContaining({...snapshot.result,subjectId:"owned",originalImageUrl:snapshot.input.originalImageBase64}));expect(m.push).toHaveBeenCalledWith("/notebooks/owned");
 });
 it("does not overwrite local edits on refresh or a newer answer; replacement is confirmed and revalidated",async()=>{
  await render();const field=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"my edit");field.dispatchEvent(new Event("input",{bubbles:true}));});
  await render({...snapshot,revision:3});expect(field.value).toBe("my edit");
  const next={...snapshot,revision:4,result:{...snapshot.result,answerText:"new answer"}};await render(next);expect(field.value).toBe("my edit");
  vi.mocked(window.confirm).mockReturnValueOnce(false);await click("采用新回复替换编辑内容");expect(m.get).not.toHaveBeenCalled();
  m.get.mockResolvedValueOnce({id:"c",state:"answered",...next});await click("采用新回复替换编辑内容");expect(host.querySelector("textarea")!.value).toBe("new answer");
 });
 it("rejects a replacement when another tab starts a round",async()=>{
  await render();await render({...snapshot,revision:4,result:{...snapshot.result,answerText:"new"}});m.get.mockResolvedValueOnce({state:"active",revision:5});await click("采用新回复替换编辑内容");expect(host.querySelector("textarea")!.value).toBe("a");expect(host.textContent).toContain("状态已变化");
 });
 it("preserves draft and reports a failed save instead of navigating",async()=>{
  m.post.mockRejectedValueOnce(new Error("private upstream"));await render();await click("save fixture");expect(m.push).not.toHaveBeenCalled();expect(host.textContent).toContain("未确认保存成功");expect(host.textContent).not.toContain("private upstream");
 });
});

it('pairs checked geometry with the answer draft and detects evidence-only updates',async()=>{
 const checked={...snapshot,geometryChecked:true,transcript:{text:'source',facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[],angles:[{label:'1',vertex:'B',arms:['A','C'] as [string,string]}]}}};
 await render(checked);expect(m.editor).toHaveProperty('drawingEvidence.authority','verified');expect(m.editor).toHaveProperty('drawingEvidence.angles',checked.transcript.geometry.angles);
 await render({...checked,revision:5,transcriptClarifications:['角1改为顶点A']});expect(host.textContent).toContain('采用新回复替换编辑内容');
});
