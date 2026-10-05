// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock("@/lib/ai/chain",()=>({callChain:mocks.callChain}));
vi.mock("@/lib/ai-access/effective-config",()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock("@/lib/ai-access/runtime",()=>({runtimeConfig:vi.fn()}));
vi.mock("@/lib/ai-drawing/settings",()=>({approvedImageEditor:vi.fn()}));
vi.mock("@/lib/ai/managed-service",()=>({dataImage:(image?:string)=>image}));
import {executeDrawing,validateDrawingInput} from "@/lib/ai-drawing/service";
import {BASE_CONSTRUCTION_PROMPT,CONSTRUCTION_PROMPT} from "@/lib/ai-drawing/construction";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
const base={title:"Synthetic triangle",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const corrected={...base,points:[{id:"A",x:4,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}]};
const raw={questionText:"Synthetic source",answerText:"Private synthetic answer",analysis:"Synthetic proof not for base",imageBase64:"data:image/png;base64,YQ==",drawingCorrection:"A移到右上角",drawingPreviousBase:base};
beforeEach(()=>vi.clearAllMocks());
describe("editable previous base is not a second-stage locked base",()=>{
 it("does not apply immutable second-stage coordinates to an editable first-stage correction",()=>{
  expect(BASE_CONSTRUCTION_PROMPT).not.toContain("不能平移、缩放或改写原有点的坐标");
  expect(BASE_CONSTRUCTION_PROMPT).not.toContain("原题底图是不可变的源图层");
  expect(BASE_CONSTRUCTION_PROMPT).toContain("允许按纠正说明修改错误点位、方向和已有连线");
  expect(BASE_CONSTRUCTION_PROMPT).toContain("不得整体旋转、镜像或翻转原题底图");
  expect(CONSTRUCTION_PROMPT).toContain("不能平移、缩放或改写原有点的坐标");
  expect(CONSTRUCTION_PROMPT).toContain("用户已核对并锁定lockedBase");
 });
 it("preserves the previous base through persisted job input and sends it only as first-stage correction context",async()=>{
  const input=JobInputSchema.parse(JSON.parse(JSON.stringify(raw)));
  expect(input).toHaveProperty("drawingPreviousBase",base);
  mocks.callChain.mockImplementation(async(_p,text,image,parse,options)=>{
   const request=JSON.parse(text);expect(request.previousBase).toEqual(base);expect(request.correction).toBe(raw.drawingCorrection);
   expect(request).not.toHaveProperty("lockedBase");expect(request).not.toHaveProperty("answer");expect(request).not.toHaveProperty("analysis");
   expect(image).toBe(raw.imageBase64);expect(options.role).toBe("recognize");return parse(JSON.stringify(corrected));
  });
  await validateDrawingInput("construction",input,"synthetic-user");
  expect(await executeDrawing("construction",input)).toEqual({type:"construction",plan:corrected});expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
 it("refuses ambiguous jobs that submit previous and locked bases together",()=>{
  expect(()=>JobInputSchema.parse({...raw,drawingPlan:base})).toThrow();
 });
 it("refuses auxiliary steps inside a supposedly first-stage previous base",()=>{
  expect(()=>JobInputSchema.parse({...raw,drawingPreviousBase:{...base,steps:[{description:"New line",operation:{kind:"segment",a:"A",b:"C"}}]}})).toThrow();
 });
 it("validates prior geometry references before accepting or calling AI",async()=>{
  const input=JobInputSchema.parse({...raw,drawingPreviousBase:{...base,segments:[["A","Z"]]}});
  await expect(validateDrawingInput("construction",input,"synthetic-user")).rejects.toThrow();await expect(executeDrawing("construction",input)).rejects.toThrow();expect(mocks.callChain).not.toHaveBeenCalled();
 });
 it("does not turn an unchanged provider result into an automatic paid retry",async()=>{
  mocks.callChain.mockImplementation(async(_p,_text,_image,parse)=>parse(JSON.stringify(base)));
  expect(await executeDrawing("construction",JobInputSchema.parse(raw))).toEqual({type:"construction",plan:base});expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
});