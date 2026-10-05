// @vitest-environment node
// Synthetic audit: checks transport/state contracts, not whether a real model can solve a user's construction.
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock("@/lib/ai/chain",()=>({callChain:mocks.callChain}));
vi.mock("@/lib/ai-access/effective-config",()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock("@/lib/ai-access/runtime",()=>({runtimeConfig:vi.fn()}));
vi.mock("@/lib/ai-drawing/settings",()=>({approvedImageEditor:vi.fn()}));
vi.mock("@/lib/ai/managed-service",()=>({dataImage:(image?:string)=>image}));
import {executeDrawing} from "@/lib/ai-drawing/service";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
import {parseConstructionSteps} from "@/lib/ai-drawing/parse";
import {CONSTRUCTION_PROMPT,type ConstructionPlan} from "@/lib/ai-drawing/construction";
const previous:ConstructionPlan={title:"Synthetic source",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],segments:[["A","B"],["B","C"]],steps:[]};
const corrected:ConstructionPlan={...previous,points:[{id:"A",x:4,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0}],notes:[{text:"人工补充1（较新说明优先）：A应移到右上方",status:"confirmed"}]};
const steps:ConstructionPlan["steps"]=[{description:"Connect the existing points A and C",operation:{kind:"segment",a:"A",b:"C"}}];
const source={questionText:"Synthetic triangle",answerText:"Connect A to C",analysis:"Synthetic explanation",drawingCorrection:"A应移到右上方"};
beforeEach(()=>vi.clearAllMocks());
describe("corrected-base handoff audit",()=>{
 it("uses the corrected serialized base rather than the previous base on the next request",async()=>{
  const prior=structuredClone(previous),updated=structuredClone(corrected);
  mocks.callChain.mockImplementationOnce(async(_prompt,text,_image,parse)=>{
   expect(JSON.parse(text).previousBase).toEqual(previous);
   return parse(JSON.stringify(corrected));
  });
  const first=await executeDrawing("construction",JobInputSchema.parse({...source,drawingPreviousBase:previous}));
  if(first.type!=="construction")throw Error("Expected construction");
  const next=JobInputSchema.parse(JSON.parse(JSON.stringify({...source,drawingPlan:first.plan,answerText:"Current answer"})));
  mocks.callChain.mockImplementationOnce(async(prompt,text,image,parse)=>{
   const body=JSON.parse(text);
   expect(prompt).toBe(CONSTRUCTION_PROMPT);expect(body.lockedBase).toEqual(corrected);
   expect(body.answer).toBe("Current answer");expect(body).not.toHaveProperty("previousBase");
   expect(body).not.toHaveProperty("drawingPreviousBase");expect(image).toBeUndefined();
   return parse(JSON.stringify({steps}));
  });
  expect(await executeDrawing("construction",next)).toEqual({type:"construction",plan:{...corrected,steps}});
  expect(mocks.callChain).toHaveBeenCalledTimes(2);expect(previous).toEqual(prior);expect(corrected).toEqual(updated);
 });
 it("does not reject a supported construction merely because the locked base contains a manual correction note",()=>{
  expect(parseConstructionSteps(JSON.stringify({steps}),corrected)).toEqual({...corrected,steps});
 });
 it("does not automatically repeat the drawing call after an explicit unsupported response",async()=>{
  mocks.callChain.mockImplementation(async(_prompt,_text,_image,parse)=>parse('{"unsupported":true}'));
  await expect(executeDrawing("construction",JobInputSchema.parse({...source,drawingPlan:corrected}))).rejects.toMatchObject({code:"AI_DRAWING_UNSUPPORTED",diagnostic:"DRAWING_UNSUPPORTED",fallback:false});
  expect(mocks.callChain).toHaveBeenCalledTimes(1);expect(corrected.steps).toEqual([]);
 });
 it("distinguishes an invalid operation from a model's explicit unsupported result",()=>{
  expect(()=>parseConstructionSteps('{"steps":[{"description":"Not a supported operation","operation":{"kind":"line_circle_intersection","id":"P","a":"A","b":"B"}}]}',corrected)).toThrow(expect.objectContaining({code:"AI_RESPONSE_ERROR",diagnostic:"DRAWING_SCHEMA_FIELDS"}));
 });
 it("refuses to replace corrected base coordinates even when a full returned plan would be geometrically valid",()=>{
  expect(()=>parseConstructionSteps(JSON.stringify({...previous,steps}),corrected)).toThrow(expect.objectContaining({code:"AI_RESPONSE_ERROR",diagnostic:"DRAWING_SCHEMA_FIELDS"}));
 });
});
