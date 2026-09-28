import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/geogebra-demo", () => ({ GeogebraDemo: () => <div>external</div> }));
import { AuxiliaryDrawing } from "@/components/auxiliary-drawing";
import { ConstructionSchema, compileConstruction, CONSTRUCTION_PROMPT, constructionExamples } from "@/lib/ai-drawing/construction";
import { ApiError, apiClient } from "@/lib/api-client";
import { diagnosticMessage } from "@/lib/ai/diagnostics";

const plan = { title: "Synthetic midpoint", points: [{id:"A",x:0,y:0},{id:"B",x:6,y:0},{id:"C",x:2,y:4}], segments:[["A","B"],["B","C"],["C","A"]], steps:[{description:"Take the midpoint",operation:{kind:"midpoint",id:"M",a:"A",b:"B"}},{description:"Join the vertex",operation:{kind:"segment",a:"C",b:"M"}}] };
const response = (data: unknown, status=200) => new Response(JSON.stringify(data), {status});
let host: HTMLDivElement, root: Root;
beforeEach(() => {vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.unstubAllGlobals();});
async function submit() {
    vi.spyOn(window,"confirm").mockReturnValue(true);
    await act(async () => root.render(<AuxiliaryDrawing questionText="Synthetic question" answerText="Synthetic answer" analysis="Synthetic construction"/>));
    await act(async () => [...host.querySelectorAll("button")].find(b=>b.textContent==="第一步：生成原题底图")!.click());
}
function failedFetch(errorCode: string, diagnostic?: string) {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({jobId:"synthetic-drawing"},202)).mockResolvedValueOnce(response({state:"failed",errorCode,attemptsLog:[{state:"failed",errorCode,diagnostic}]}));
    vi.stubGlobal("fetch",fetchMock);return fetchMock;
}

describe("construction prompt matches the strict executable contract", () => {
    it("reproduces duplicate-point rejection without weakening validation", () => {
        expect(()=>compileConstruction(ConstructionSchema.parse(plan))).not.toThrow();
        expect(()=>compileConstruction(ConstructionSchema.parse({...plan,points:[...plan.points,{id:"M",x:3,y:0}]}))).toThrow();
    });
    it("does not instruct the model to predefine step-created points in the foundation", () => {
        expect(CONSTRUCTION_PROMPT).not.toContain("所有引用点先在points定义");
        expect(CONSTRUCTION_PROMPT).toContain("新点不得提前放入points");
    });
    it("provides compilable JSON examples covering every allowed operation", () => {
        const examples=constructionExamples;
        const outputs=CONSTRUCTION_PROMPT.split("\n").filter(line=>line.startsWith('{"steps":')).map(line=>JSON.parse(line));
        expect(outputs).toEqual(examples.map(({steps})=>({steps})));
        expect(examples.length).toBeGreaterThan(0);
        const kinds=new Set<string>();
        for(const example of examples){compileConstruction(example);for(const step of example.steps){kinds.add(step.operation.kind);if("id" in step.operation)expect(example.points.map(p=>p.id)).not.toContain(step.operation.id);}}
        expect([...kinds].sort()).toEqual(["foot","intersection","midpoint","reflect","rotate","segment"]);
    });
});

describe("durable task polling keeps safe final-attempt diagnostics", () => {
    it("retains a whitelisted diagnostic, but no provider/private output", async () => {
        const fetchMock=vi.fn().mockResolvedValueOnce(response({jobId:"synthetic-drawing"},202)).mockResolvedValueOnce(response({state:"failed",errorCode:"AI_RESPONSE_ERROR",attemptsLog:[{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"JSON_SCHEMA_INVALID",raw:"private-provider-body",providerUrl:"https://private.invalid"}]}));
        vi.stubGlobal("fetch",fetchMock);
        await expect(apiClient.post("/api/ai/drawing/construction",{})).rejects.toMatchObject({data:{message:"AI_RESPONSE_ERROR",jobId:"synthetic-drawing",diagnostic:"JSON_SCHEMA_INVALID"}});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it.each([
        {state:"failed",errorCode:"AI_RESPONSE_ERROR",attemptsLog:[{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"private-provider-body"}]},
        {state:"failed",errorCode:"AI_ACCESS_REVOKED",attemptsLog:[{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"JSON_SCHEMA_INVALID"}]},
        {state:"failed",errorCode:"AI_RESPONSE_ERROR",attemptsLog:[{state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"JSON_SCHEMA_INVALID"},{state:"failed",errorCode:"AI_RATE_LIMIT"}]},
        {state:"cancelled",errorCode:"AI_CANCELLED",attemptsLog:[{state:"running",errorCode:"AI_CANCELLED",diagnostic:"JSON_SCHEMA_INVALID"}]},
        {state:"failed",errorCode:"AI_RESPONSE_ERROR"},
    ])("does not reuse stale, unknown or running-attempt diagnostics: %j", async job => {
        vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(job)));
        const error=await apiClient.get("/api/ai/jobs/synthetic-drawing");
        expect(error).toEqual(job);
        const fetchMock=vi.fn().mockResolvedValueOnce(response({jobId:"synthetic-drawing"},202)).mockResolvedValueOnce(response(job));vi.stubGlobal("fetch",fetchMock);
        const stopped=await apiClient.post("/api/ai/drawing/construction",{}).catch(e=>e);
        if (!(stopped instanceof ApiError)) throw new Error("Expected an ApiError");
        expect(stopped.data).not.toHaveProperty("diagnostic");expect(stopped.data).not.toHaveProperty("attemptsLog");expect(JSON.stringify(stopped.data)).not.toContain("private-provider-body");
    });
});

describe("drawing failures are actionable without automatic paid resubmission", () => {
    it("shows the precise format diagnostic and retains the owned task link", async () => {
        const fetchMock=failedFetch("AI_RESPONSE_ERROR","JSON_SCHEMA_INVALID");await submit();
        expect(host.querySelector('[role="status"]')?.textContent).toContain(diagnosticMessage("JSON_SCHEMA_INVALID"));
        expect(host.querySelector('a[href="/ai-tasks?job=synthetic-drawing"]')).not.toBeNull();expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(host.querySelector('[role="status"]')?.textContent).not.toContain("图片编辑需管理员");
    });
    it.each([
        ["AI_DRAWING_INVALID","构造坐标或依赖不合法"],
        ["AI_NO_TEXT_MODEL","解题模型"],
        ["AI_RATE_LIMIT","限流"],
        ["AI_IMAGE_EDIT_SETTINGS_CHANGED","设置已变更"],
        ["AI_IMAGE_EDIT_NO_IMAGE","没有返回可用图片"],
        ["AI_IMAGE_EDIT_INVALID_IMAGE","图片无法解码"],
        ["AI_ACCEPTANCE_UNKNOWN","不要重复提交"],
        ["AI_DRAWING_UNSUPPORTED","白名单"],
    ])("shows a safe specific message for %s", async (code,text) => {
        const fetchMock=failedFetch(code);await submit();expect(host.querySelector('[role="status"]')?.textContent).toContain(text);expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("shows body-timeout diagnostics without treating the task as a safe retry", async () => {
        const fetchMock=failedFetch("AI_ACCEPTANCE_UNKNOWN","TIMEOUT_READING_BODY");await submit();expect(host.querySelector('[role="status"]')?.textContent).toContain(diagnosticMessage("TIMEOUT_READING_BODY"));expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("never echoes untrusted upstream text or error codes", async () => {
        failedFetch("private-provider-body","private-provider-body");await submit();expect(host.textContent).not.toContain("private-provider-body");expect(host.querySelector('[role="status"]')?.textContent).toContain("作图未确认完成");
    });
});


describe('construction schema diagnostics from actual failure pattern',()=>{
 it('retains the last parse failure when the chain terminates with budget exhaustion',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({jobId:'synthetic-budget'},202)).mockResolvedValueOnce(response({state:'failed',errorCode:'AI_BUDGET_EXHAUSTED',attemptsLog:[{state:'failed',errorCode:'AI_RESPONSE_ERROR',diagnostic:'JSON_SCHEMA_INVALID'}]})));
  await expect(apiClient.post('/api/ai/drawing/construction',{})).rejects.toMatchObject({data:{message:'AI_BUDGET_EXHAUSTED',diagnostic:'JSON_SCHEMA_INVALID'}});
 });
 it('distinguishes missing operation fields from impossible geometry',async()=>{
  const {parseConstruction}=await import('@/lib/ai-drawing/parse');
  const base={title:'synthetic',points:[{id:'A',x:0,y:0},{id:'B',x:2,y:0}],segments:[],steps:[{description:'rotate',operation:{kind:'rotate',id:'C',point:'A',center:'B'}}]};
  expect(()=>parseConstruction(JSON.stringify(base))).toThrow(expect.objectContaining({diagnostic:'DRAWING_SCHEMA_OPERATION'}));
  expect(()=>parseConstruction(JSON.stringify({...base,points:[{id:'BadName',x:0,y:0},{id:'B',x:2,y:0}],steps:[{description:'join',operation:{kind:'segment',a:'A',b:'B'}}]}))).toThrow(expect.objectContaining({diagnostic:'DRAWING_SCHEMA_POINT'}));
 });
 it('continues to reject extra fields and never echoes their contents',async()=>{
  const {parseConstruction}=await import('@/lib/ai-drawing/parse');
  expect(()=>parseConstruction(JSON.stringify({unsupported:true,reason:'private-upstream-marker'}))).toThrow(expect.objectContaining({diagnostic:'DRAWING_SCHEMA_FIELDS'}));
 });
});
