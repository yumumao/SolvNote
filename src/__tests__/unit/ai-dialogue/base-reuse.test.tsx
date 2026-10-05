import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({
        language: "zh",
        t: { editor: { save: "保存", cancel: "取消" }, common: {}, errors: {} },
    }),
}));
vi.mock("@/lib/frontend-logger", () => ({
    frontendLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/markdown-renderer", () => ({
    MarkdownRenderer: () => null,
}));
vi.mock("@/components/tag-input", () => ({ TagInput: () => null }));
vi.mock("@/components/notebook-selector", () => ({
    NotebookSelector: ({ value }: { value?: string }) =>
        createElement("span", { "data-testid": "notebook" }, value),
}));
vi.mock("@/components/geogebra-demo", () => ({
    GeogebraDemo: ({ commands }: { commands: string }) =>
        createElement("pre", { "data-testid": "geogebra" }, commands),
}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
import {ConversationAnswerEditor,type AnswerSnapshot} from "@/components/conversation-answer-editor";
import {apiClient} from "@/lib/api-client";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
import type {ConstructionPlan} from "@/lib/ai-drawing/construction";
const base:ConstructionPlan={title:"Synthetic source",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const auxiliary:ConstructionPlan={...base,steps:[{description:"连接AC",operation:{kind:"segment",a:"A",b:"C"}}]};
let host:HTMLDivElement,root:Root,snapshot:AnswerSnapshot;
const mockPost=()=>vi.spyOn(apiClient,"post");
let post:ReturnType<typeof mockPost>;
const main=()=>host.querySelector('[data-current-answer="true"]')!;
const render=async(s=snapshot,id="c")=>{await act(async()=>root.render(<ConversationAnswerEditor key={id} id={id} snapshot={s}/>));};
const next=(revision=4)=>({...snapshot,revision,result:{...snapshot.result,answerText:"new answer "+revision,analysis:"new proof "+revision}});
const button=(label:string)=>[...main().querySelectorAll("button")].find(b=>b.textContent===label)!;
const click=async(b:HTMLButtonElement)=>{expect(b).toBeDefined();await act(async()=>b.click());};
const first=()=>click(button("第一步：生成原题底图"));
const correct=async(value:string)=>{await act(async()=>{const f=main().querySelector('textarea[data-drawing-correction]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(f,value);f.dispatchEvent(new Event("input",{bubbles:true}));});};
const lock=async()=>{await act(async()=>(main().querySelector('input[data-confirm-base]') as HTMLInputElement).click());};
const svg=()=>main().querySelector('[data-drawing-stage="base"] svg[role="img"]');
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(window,"confirm").mockReturnValue(true);
 vi.spyOn(apiClient,"get").mockImplementation(async url=>(url==="/api/notebooks"?[]:{}) as never);
 post=vi.spyOn(apiClient,"post").mockResolvedValue({type:"construction",plan:base});
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 snapshot={revision:2,input:JobInputSchema.parse({questionText:"synthetic",subjectId:"owned",imageBase64:"data:image/png;base64,YQ=="}),result:{questionText:"Synthetic triangle",answerText:"answer",analysis:"proof",subject:"数学",knowledgePoints:[],mistakeStatus:"unknown",wrongAnswerText:"",mistakeAnalysis:"",requiresImage:true}};
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("same-question base reuse across solution versions",()=>{
 it("reuses only on the first-step click, keeps old auxiliary steps out and sends the new solution in step two",async()=>{
  await render();await first();await lock();post.mockResolvedValueOnce({type:"construction",plan:auxiliary});await click(button("第二步：在锁定底图上添加辅助线"));
  const before=svg()!.outerHTML;await render(next());expect(svg()).toBeNull();expect(post).toHaveBeenCalledTimes(2);
  vi.mocked(window.confirm).mockClear();await first();expect(post).toHaveBeenCalledTimes(2);expect(window.confirm).not.toHaveBeenCalled();expect(svg()!.outerHTML).toBe(before);expect(main().textContent).toContain("已复用");
  expect((main().querySelector('input[data-confirm-base]') as HTMLInputElement).checked).toBe(false);expect(button("第二步：在锁定底图上添加辅助线").disabled).toBe(true);
  expect(main().querySelector('[data-drawing-stage="auxiliary"] svg[role="img"]')).toBeNull();
  await lock();post.mockResolvedValueOnce({type:"construction",plan:auxiliary});await click(button("第二步：在锁定底图上添加辅助线"));
  expect(post).toHaveBeenCalledTimes(3);expect(post.mock.calls[2][1]).toMatchObject({answerText:"new answer 4",analysis:"new proof 4",drawingPlan:{steps:[]}});
 });
 it("retains the successful human-corrected base and correction when changing method, but explicit regeneration still makes a new request",async()=>{
  await render();await first();await correct("A位于右上角");const fixed={...base,title:"Corrected source",points:[{id:"A",x:4,y:4},...base.points.slice(1)]};post.mockResolvedValueOnce({type:"construction",plan:fixed});await click(button("根据纠正说明重新生成原题底图"));
  await render(next());await first();expect(post).toHaveBeenCalledTimes(2);expect((main().querySelector('textarea[data-drawing-correction]') as HTMLTextAreaElement).value).toBe("A位于右上角");expect(main().querySelector('[role="alert"]')).toBeNull();
  await click(button("根据纠正说明重新生成原题底图"));expect(post).toHaveBeenCalledTimes(3);expect(post.mock.calls[2][1]).toMatchObject({drawingCorrection:"A位于右上角",drawingPreviousBase:{title:"Corrected source"}});
 });
 it.each(["question","image","evidence"])("does not reuse when %s changes",async change=>{
  await render();await first();const fresh=next();
  if(change==="question")fresh.result.questionText="Different given conditions";
  if(change==="image")fresh.input={...fresh.input,imageBase64:"data:image/png;base64,Yg=="};
  const s:AnswerSnapshot=change==="evidence"?{...fresh,transcript:{text:"new verified marks",facts:[],uncertainties:[],missingInformation:[]},geometryChecked:true}:fresh;
  await render(s);await first();expect(post).toHaveBeenCalledTimes(2);
 });
 it("does not reuse a cached base over new correction text",async()=>{
  await render();await first();await render(next());await correct("本版需要纠正B点位置");await first();expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1][1]).toMatchObject({drawingCorrection:"本版需要纠正B点位置"});
 });
 it("never shares a cached diagram with a separate conversation",async()=>{
  await render();await first();await render(next(),"separate");await first();expect(post).toHaveBeenCalledTimes(2);
 });
 it("a late older base cannot replace a newer corrected cache entry",async()=>{
  let finish!:(v:unknown)=>void;post.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await render();await first();await render(next());
  const fixed={...base,title:"Newer corrected source"};post.mockResolvedValueOnce({type:"construction",plan:fixed});await first();await act(async()=>finish({type:"construction",plan:base}));
  await render(next(6));await first();expect(post).toHaveBeenCalledTimes(2);expect(svg()?.getAttribute("aria-label")).toContain("Newer corrected source");
 });
 it("folds the archived version into a subtly tinted, separately bordered container",async()=>{
  await render();await render(next());const old=host.querySelector('[data-current-answer="false"]')!;expect(old.getAttribute("class")).toContain("bg-slate-50");expect(old.getAttribute("class")).toContain("border-slate-200");expect(old.getAttribute("class")).toContain("[&_[data-slot=card]]:bg-transparent");expect(old.hasAttribute("open")).toBe(false);expect(main().getAttribute("class")).not.toContain("bg-slate-50");
 });

 it("does not reuse a base known to need an unsent correction",async()=>{
  await render();await first();await correct("已知旧底图位置错误，尚未提交");await render(next());await first();expect(post).toHaveBeenCalledTimes(2);
 });
 it("does not cache failed or invalid first-stage results",async()=>{
  post.mockRejectedValueOnce(Error("synthetic failure"));await render();await first();await render(next());await first();expect(post).toHaveBeenCalledTimes(2);
  await render(next(6),"another");post.mockResolvedValueOnce({type:"construction",plan:auxiliary});await first();expect(svg()).toBeNull();await render(next(8),"another");await first();expect(post).toHaveBeenCalledTimes(4);
 });
 it("an explicit first-step click on an already visible base still regenerates rather than silently reusing",async()=>{
  await render();await first();await first();expect(post).toHaveBeenCalledTimes(2);expect(post.mock.calls[1][1]).toHaveProperty("drawingPreviousBase");
 });
});
