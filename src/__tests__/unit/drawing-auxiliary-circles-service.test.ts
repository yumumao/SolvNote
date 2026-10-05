// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
const {callChain}=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock("@/lib/ai/chain",()=>({callChain}));
vi.mock("@/lib/ai-access/effective-config",()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock("@/lib/ai-access/runtime",()=>({runtimeConfig:vi.fn()}));
vi.mock("@/lib/ai-drawing/settings",()=>({approvedImageEditor:vi.fn()}));
vi.mock("@/lib/ai/managed-service",()=>({dataImage:()=>undefined}));
import {executeDrawing,validateDrawingInput} from "@/lib/ai-drawing/service";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
import {compileConstruction,type ConstructionPlan} from "@/lib/ai-drawing/construction";
const base:ConstructionPlan={title:"Synthetic corrected base",points:[{id:"O",x:0,y:0},{id:"A",x:6,y:0}],segments:[["O","A"]],notes:[{text:"人工补充1（较新说明优先）：合成纠正已确认",status:"confirmed"}],steps:[]};
const steps:ConstructionPlan["steps"]=[{description:"Construct midpoint",operation:{kind:"midpoint",id:"M",a:"O",b:"A"}},{description:"Construct diameter circle",operation:{kind:"circle",center:"M",through:"A"}}];
describe("auxiliary-circle service roundtrip",()=>{
 it("accepts steps-only circles on a corrected base with no new provider call or base mutation",async()=>{
  const before=structuredClone(base);callChain.mockImplementationOnce(async(_system,_user,_image,parse:(raw:string)=>unknown)=>parse(JSON.stringify({steps})));
  const input=JobInputSchema.parse({questionText:"Synthetic",analysis:"Use a diameter circle",drawingPlan:base});
  await validateDrawingInput("construction",input,"synthetic-user");const result=await executeDrawing("construction",input);
  expect(callChain).toHaveBeenCalledTimes(1);expect(JSON.parse(callChain.mock.calls[0][1]).lockedBase).toEqual(before);expect(base).toEqual(before);
  expect(result.type).toBe("construction");if(result.type!=="construction")throw Error("Wrong result type");
  const restored=JobInputSchema.parse({questionText:"Synthetic",drawingPlan:JSON.parse(JSON.stringify(result.plan))});expect(compileConstruction(restored.drawingPlan!).geometry.derivedCircles).toHaveLength(1);
 });
});
