// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({callChain:vi.fn()}));
vi.mock("@/lib/ai/chain",()=>({callChain:mocks.callChain}));
vi.mock("@/lib/ai-access/effective-config",()=>({loadEffectiveAIConfig:vi.fn()}));
vi.mock("@/lib/ai-access/runtime",()=>({runtimeConfig:vi.fn()}));
vi.mock("@/lib/ai-drawing/settings",()=>({approvedImageEditor:vi.fn()}));
vi.mock("@/lib/ai/managed-service",()=>({dataImage:(image?:string)=>image}));
import {executeDrawing,validateDrawingInput} from "@/lib/ai-drawing/service";
import {ConstructionSchema,compileConstruction} from "@/lib/ai-drawing/construction";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
import {solvePrompt} from "@/lib/ai-dialogue/protocol";
import {generateGradeInstruction} from "@/lib/ai/prompts";
const base={title:"Source orientation",points:[{id:"A",x:0,y:4},{id:"B",x:0,y:0},{id:"C",x:4,y:0},{id:"D",x:4,y:4}],segments:[["A","B"],["B","C"],["C","D"],["D","A"]],steps:[]};
const extra={steps:[{description:"Reflect B across AC without moving B",operation:{kind:"reflect",id:"P",point:"B",a:"A",b:"C"}}]};
const input=JobInputSchema.parse({questionText:"Square ABCD",answerText:"Answer",analysis:"Rotate a COPY only",imageBase64:"data:image/png;base64,YQ=="});
beforeEach(()=>{vi.clearAllMocks();});
describe("two separately accepted drawing stages",()=>{
 it("generates only the source before reading any solution or auxiliary instructions",async()=>{
  mocks.callChain.mockImplementationOnce(async(_p,t,_i,parse)=>{expect(JSON.parse(t)).toEqual({question:input.questionText,correction:""});return parse(JSON.stringify(base));});
  expect(await executeDrawing("construction",input)).toEqual({type:"construction",plan:base});
  expect(mocks.callChain).toHaveBeenCalledTimes(1);
  expect(mocks.callChain.mock.calls[0][0]).toContain("steps必须为空数组");
  expect(mocks.callChain.mock.calls[0][2]).toBe(input.imageBase64);
 });
 it("sends nonempty source corrections but never solution fields to the first-stage AI",async()=>{
  const corrected={...input,drawingCorrection:"A应在左上角，AB竖直；只纠正原题图"};
  mocks.callChain.mockImplementationOnce(async(_prompt,text,image,parse)=>{
   expect(JSON.parse(text)).toEqual({question:input.questionText,correction:corrected.drawingCorrection});
   expect(text).not.toContain(input.answerText);expect(text).not.toContain(input.analysis);
   expect(image).toBe(input.imageBase64);return parse(JSON.stringify(base));
  });
  expect(await executeDrawing("construction",corrected)).toEqual({type:"construction",plan:base});
  expect(mocks.callChain).toHaveBeenCalledTimes(1);
 });
 it("rejects auxiliaries sneaked into the source stage",async()=>{
  mocks.callChain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify({...base,steps:extra.steps})));
  await expect(executeDrawing("construction",input)).rejects.toThrow();
 });
 it("merges only steps onto a validated frozen snapshot, including after JSON persistence",async()=>{
  const saved=JSON.parse(JSON.stringify(base)); const before=JSON.stringify(saved);
  mocks.callChain.mockImplementationOnce(async(_p,t,i,parse)=>{expect(JSON.parse(t).lockedBase).toEqual(saved);expect(i).toBeUndefined();return parse(JSON.stringify(extra));});
  const result=await executeDrawing("construction",{...input,drawingPlan:saved});
  expect(result).toEqual({type:"construction",plan:{...base,...extra}});
  expect(JSON.stringify(saved)).toBe(before);
  expect(compileConstruction(ConstructionSchema.parse(result.type==="construction"?result.plan:{})).geometry.basePoints.map(({id,x,y})=>({id,x,y}))).toEqual(base.points);
 });
 it.each(["points","segments","circles","arcs","title"])("rejects attempts to replace base %s",async field=>{
  mocks.callChain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify({...extra,[field]:field==="title"?"rotated":[]})));
  await expect(executeDrawing("construction",{...input,drawingPlan:base as never})).rejects.toThrow();
 });
 it("validates source dependencies before dispatch and refuses a completed plan as a new base",async()=>{
  const bad=JSON.parse(JSON.stringify({...base,steps:extra.steps}));
  await expect(validateDrawingInput("construction",{...input,drawingPlan:bad},"synthetic-user")).rejects.toThrow();
  await expect(executeDrawing("construction",{...input,drawingPlan:bad})).rejects.toThrow();
  expect(mocks.callChain).not.toHaveBeenCalled();
 });
 it("supports a source-only plan through job schema, compiler and reflection",()=>{
  expect(JobInputSchema.parse({...input,drawingPlan:base,drawingCorrection:"A在左上，原图不旋转"}).drawingCorrection).toBe("A在左上，原图不旋转");expect(JobInputSchema.parse({...input,drawingPlan:base}).drawingPlan).toEqual(base);
  const result=compileConstruction(ConstructionSchema.parse({...base,...extra}));
  expect(result.geometry.derivedPoints[0]).toMatchObject({id:"P",x:4,y:4});
  expect(result.steps[0].commands[0]).toBe("P=Reflect(B,Line(A,C))");
  expect(()=>compileConstruction(ConstructionSchema.parse({...base,steps:[{description:"bad",operation:{kind:"reflect",id:"B",point:"B",a:"A",b:"C"}}]}))).toThrow();
 });
 it("requires constructible instructions before numeric angle properties",()=>{
  for(const text of [solvePrompt("五年级"),generateGradeInstruction("primary_5","zh")]){
   expect(text).toContain("尺规");expect(text).toContain("先构造");expect(text).toContain("再证明");expect(text).toContain("复制已知角");
  }
  expect(generateGradeInstruction("primary_5","en")).toContain("straightedge and compass");
 });
});

it("fixes every original object in the optional dynamic demo as well",()=>{
 const compiled=compileConstruction(ConstructionSchema.parse(base));
 for(const id of ["A","B","C","D","base0","base1","base2","base3"])
  expect(compiled.base).toContain(`setFixed(${id},true,false)`);
});
it("constructs the reported 24-degree auxiliary point by reflection, not arbitrary angle placement",()=>{
 const e=Math.tan(12*Math.PI/180);
 const source=ConstructionSchema.parse({title:"Synthetic square reflection regression",points:[{id:"A",x:0,y:1},{id:"B",x:0,y:0},{id:"C",x:1,y:0},{id:"D",x:1,y:1},{id:"E",x:e,y:0}],segments:[["A","B"],["B","C"],["C","D"],["D","A"],["A","E"]],steps:[{description:"Reflect B in AE; angles follow from congruence",operation:{kind:"reflect",id:"P",point:"B",a:"A",b:"E"}}]});
 const copy=JSON.stringify(source);const geometry=compileConstruction(source).geometry;
 const p=geometry.derivedPoints[0];expect(Math.hypot(p.x,p.y-1)).toBeCloseTo(1);
 expect(p.x).toBeGreaterThan(0);expect(p.x).toBeLessThan(1);expect(p.y).toBeGreaterThan(0);expect(p.y).toBeLessThan(1);
 expect(Math.acos(1-p.y)*180/Math.PI).toBeCloseTo(24);
 expect(JSON.stringify(source)).toBe(copy);expect(geometry.basePoints.map(({id,x,y})=>({id,x,y}))).toEqual(source.points);
});
