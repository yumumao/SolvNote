// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {GeometryEvidence} from "@/components/geometry-evidence";
import {AuxiliaryDrawing} from "@/components/auxiliary-drawing";
const mock=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("@/lib/api-client",()=>({apiClient:mock,ApiError:class extends Error{}}));
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:({commands}:{commands:string})=><pre data-testid="geometry">{commands}</pre>}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();mock.get.mockReset();mock.post.mockReset();});
const button=(name:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(name))!;
async function input(value:string){const t=host.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(t,value);t.dispatchEvent(new Event("input",{bubbles:true}));});}
const transcript={text:"original synthetic statement",facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[],angles:[{label:"1",vertex:"Q",arms:["P","R"] as [string,string]}]}};
const plan={title:"synthetic",points:[{id:"P",x:0,y:0},{id:"Q",x:4,y:0}],segments:[],steps:[{description:"midpoint",operation:{kind:"midpoint",id:"M",a:"P",b:"Q"}}]};
describe("geometry evidence and drawing UI",()=>{
 it("shows ray binding and submits a complete correction, preserving the editing revision",async()=>{
  const save=vi.fn().mockResolvedValue(true);await act(async()=>root.render(<GeometryEvidence transcript={transcript} revision={7} onCorrect={save}/>));
  expect(host.textContent).toContain("∠PQR");await act(async()=>button("修订完整题设").click());await input("corrected complete statement");await act(async()=>button("采用修订并继续").click());expect(save).toHaveBeenCalledWith("corrected complete statement",7,false);
 });
 it("keeps a draft but prevents committing over a newer revision",async()=>{
  const save=vi.fn(),props={transcript,revision:7,onCorrect:save};await act(async()=>root.render(<GeometryEvidence {...props}/>));await act(async()=>button("修订完整题设").click());await input("draft retained");await act(async()=>root.render(<GeometryEvidence {...props} revision={8}/>));expect(host.querySelector("textarea")?.value).toBe("draft retained");expect(button("采用修订并继续").disabled).toBe(true);
 });
 it("requires an explicit click and fee confirmation, sends current editor fields, and saves constrained commands",async()=>{
  mock.post.mockResolvedValue({type:"construction",plan});const confirm=vi.spyOn(window,"confirm").mockReturnValue(true),save=vi.fn();
  await act(async()=>root.render(<AuxiliaryDrawing questionText="edited q" answerText="edited a" analysis="edited steps" onUseCommands={save}/>));expect(mock.post).not.toHaveBeenCalled();await act(async()=>button("生成分步辅助线方案").click());expect(mock.post).toHaveBeenCalledWith("/api/ai/drawing/construction",expect.objectContaining({questionText:"edited q",answerText:"edited a",analysis:"edited steps"}));expect(confirm).toHaveBeenCalled();expect(host.textContent).toContain("midpoint");await act(async()=>button("保留全部步骤到当前题目").click());expect(save.mock.calls[0][0]).toContain("Midpoint(P,Q)");
 });
 it("does not apply a stale construction to edited content",async()=>{
  mock.post.mockResolvedValue({type:"construction",plan});vi.spyOn(window,"confirm").mockReturnValue(true);const save=vi.fn();await act(async()=>root.render(<AuxiliaryDrawing questionText="q" answerText="a" analysis="steps" onUseCommands={save}/>));await act(async()=>button("生成分步辅助线方案").click());await act(async()=>root.render(<AuxiliaryDrawing questionText="corrected q" answerText="a" analysis="steps" onUseCommands={save}/>));expect(button("保留全部步骤到当前题目")).toBeUndefined();expect(host.textContent).toContain("旧版本构造");
 });
});
