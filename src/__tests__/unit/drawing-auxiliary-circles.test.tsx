import {act,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {describe,expect,it,vi} from "vitest";
import {compileConstruction,ConstructionSchema,CONSTRUCTION_PROMPT,type ConstructionPlan} from "@/lib/ai-drawing/construction";
import {parseConstructionBase,parseConstructionSteps} from "@/lib/ai-drawing/parse";
import {ConstructionDiagram} from "@/components/construction-diagram";
import {SolutionDocument} from "@/components/solution-document";
import {parseSolutionSnapshot,type SolutionSnapshot} from "@/lib/solution-snapshot";
// Synthetic fixture, not the user's private geometry or solution.
const base:ConstructionPlan={title:"Synthetic round construction",points:[{id:"O",x:0,y:0},{id:"A",x:8,y:0},{id:"B",x:0,y:8}],segments:[["O","A"],["O","B"]],circles:[],arcs:[{center:"O",start:"A",end:"B",direction:"ccw"}],steps:[]};
const steps:ConstructionPlan["steps"]=[
 {description:"取OA的中点M",operation:{kind:"midpoint",id:"M",a:"O",b:"A"}},
 {description:"以OA为直径作辅助圆",operation:{kind:"circle",center:"M",through:"A"}},
 {description:"取OB的中点N",operation:{kind:"midpoint",id:"N",a:"O",b:"B"}},
 {description:"以OB为直径作辅助圆",operation:{kind:"circle",center:"N",through:"B"}},
];
const plan:ConstructionPlan={...base,steps};
const outsidePlan:ConstructionPlan={...base,arcs:[],steps:[{description:"以A为圆心过O作圆",operation:{kind:"circle",center:"A",through:"O"}}]};

describe("strict auxiliary circles",()=>{
 it("adds two diameter circles without rewriting any locked base object",()=>{
  const before=structuredClone(base),result=parseConstructionSteps(JSON.stringify({steps}),base),compiled=compileConstruction(result);
  expect(base).toEqual(before);expect({...result,steps:[]}).toEqual(before);
  expect(compiled.base).toEqual(compileConstruction(base).base);
  expect(compiled.geometry.circles).toEqual([]);
  expect(compiled.geometry.derivedCircles).toEqual([{x:4,y:0,radius:4,step:2},{x:0,y:4,radius:4,step:4}]);
  expect(compiled.steps[1].commands).toEqual(["aux1=Circle(M,A)","SetColor(aux1,220,60,60)","SetLineStyle(aux1,1)"]);
  expect(compiled.steps[3].commands[0]).toBe("aux3=Circle(N,B)");
 });
 it("keeps old plans and original circles compatible",()=>{
  const legacy=compileConstruction({...base,circles:[{center:"O",through:"A"}]});
  expect(legacy.geometry.circles).toEqual([{x:0,y:0,radius:8,step:0}]);expect(legacy.geometry.derivedCircles).toEqual([]);
  expect(()=>parseConstructionBase(JSON.stringify({...base,steps}))).toThrow();
 });
 it.each([
  {kind:"circle",center:"O",through:"O"},
  {kind:"circle",center:"M",through:"A"},
  {kind:"circle",center:"O",through:"Z"},
  {kind:"circle",center:"O",through:"A",radius:8},
  {kind:"circle",center:"O",through:"A",id:"C"},
  {kind:"circle",center:"O",through:"A",commands:["Delete(O)"]},
  {kind:"circle",center:"O);Delete(A)",through:"A"},
  {kind:"circle",center:"O",through:"A",x:0,y:0},
  {kind:"circle_intersection",a:"O",b:"A"},
 ])("rejects invalid or unwhitelisted circle operation %j",operation=>{
  expect(()=>parseConstructionSteps(JSON.stringify({steps:[{description:"Synthetic",operation}]}),base)).toThrow();
 });
 it("rejects coincident coordinates even with distinct names",()=>{
  expect(()=>compileConstruction({...outsidePlan,points:base.points.map(p=>p.id==="A"?{...p,x:0,y:0}:p),segments:[],arcs:[]})).toThrow("INVALID_CONSTRUCTION");
 });
 it("keeps strict step limits and prevents changing base circles in stage two",()=>{
  expect(()=>parseConstructionSteps(JSON.stringify({steps:Array(17).fill(steps[1])}),base)).toThrow();
  expect(()=>parseConstructionSteps(JSON.stringify({steps,circles:[{center:"O",through:"A"}]}),base)).toThrow();
  expect(()=>parseConstructionSteps('{"unsupported":true}',base)).toThrow("AI_DRAWING_UNSUPPORTED");
 });
 it("advertises circle dependencies and a compilable diameter-circle example",()=>{
  expect(CONSTRUCTION_PROMPT).toContain("circle(center,through)");expect(CONSTRUCTION_PROMPT).toContain("直径");
  const examples=CONSTRUCTION_PROMPT.split("\n").filter(line=>line.startsWith('{"steps":')).map(line=>JSON.parse(line));
  expect(examples.some(p=>p.steps.some((s:{operation:{kind:string}})=>s.operation.kind==="circle"))).toBe(true);
 });
});

async function mount(run:(host:HTMLDivElement,render:(node:ReactNode)=>Promise<void>)=>Promise<void>){
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
 try{await run(host,async node=>{await act(async()=>root.render(node));});}
 finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
}
const circleBounds=(el:Element)=>{const x=Number(el.getAttribute("cx")),y=Number(el.getAttribute("cy")),r=Number(el.getAttribute("r"));return [x-r,y-r,x+r,y+r];};
function expectInside(svg:Element,el:Element){const [x,y,w,h]=svg.getAttribute("viewBox")!.split(" ").map(Number),[l,t,r,b]=circleBounds(el);expect(l).toBeGreaterThanOrEqual(x);expect(t).toBeGreaterThanOrEqual(y);expect(r).toBeLessThanOrEqual(x+w);expect(b).toBeLessThanOrEqual(y+h);}

describe("auxiliary circle display and export",()=>{
 it("shows and rewinds circles by step with an invariant base layer and viewport",async()=>mount(async(host,render)=>{
  const geometry=compileConstruction(plan).geometry;
  await render(<ConstructionDiagram geometry={compileConstruction(base).geometry} visible={0} title={base.title}/>);
  const original=host.querySelector('[data-layer="base"]')!.outerHTML,view=host.querySelector("svg")!.getAttribute("viewBox");
  for(const [visible,count] of [[0,0],[1,0],[2,1],[3,1],[4,2],[1,0]]){
   await render(<ConstructionDiagram geometry={geometry} visible={visible} title={base.title}/>);
   expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(original);expect(host.querySelector("svg")!.getAttribute("viewBox")).toBe(view);
   expect(host.querySelectorAll("[data-aux-circle]")).toHaveLength(count);
   for(const circle of host.querySelectorAll("[data-aux-circle]")){expect(circle.closest("g")!.getAttribute("data-layer")).toBe("auxiliary");expect(circle.getAttribute("stroke")).toBe("#dc2626");expect(circle.getAttribute("stroke-dasharray")).toBe("8 5");expect(circle.getAttribute("fill")).toBe("none");}
  }
 }));
 it.each([false,true])("includes the full visible circle in reading/share bounds (compact=%s)",async compact=>mount(async(host,render)=>{
  const geometry=compileConstruction(outsidePlan).geometry;
  await render(<ConstructionDiagram geometry={geometry} visible={0} title={base.title} readOnly compact={compact}/>);
  const before=host.querySelector("svg")!.getAttribute("viewBox");expect(host.querySelector("[data-aux-circle]")).toBeNull();
  await render(<ConstructionDiagram geometry={geometry} visible={1} title={base.title} readOnly compact={compact}/>);
  const svg=host.querySelector("svg")!;expectInside(svg,host.querySelector("[data-aux-circle]")!);expect(svg.getAttribute("viewBox")).not.toBe(before);
 }));
 it("warns when only a circle overflows the frozen preview and exports complete SVG",async()=>mount(async(host,render)=>{
  const geometry=compileConstruction(outsidePlan).geometry;
  let exported:Blob|undefined;vi.stubGlobal("URL",{createObjectURL:(blob:Blob)=>{exported=blob;return "blob:synthetic-circle";},revokeObjectURL:vi.fn()});
  const open=vi.spyOn(window,"open").mockReturnValue(null);
  await render(<ConstructionDiagram geometry={geometry} visible={0} title={base.title}/>);expect(host.querySelector("[data-outside-note]")).toBeNull();
  await render(<ConstructionDiagram geometry={geometry} visible={1} title={base.title}/>);expect(host.querySelector("[data-outside-note]")).not.toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>("[data-open-full-image]")!.click());expect(open).toHaveBeenCalledTimes(1);expect(exported).toBeDefined();
  const content=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsText(exported!);});
  const xml=new DOMParser().parseFromString(content,"image/svg+xml");expect(xml.querySelector("parsererror")).toBeNull();expectInside(xml.documentElement,xml.querySelector("[data-aux-circle]")!);
 }));
 it("preserves auxiliary circles across snapshot serialization and shared document rendering",async()=>mount(async(host,render)=>{
  const snapshot:SolutionSnapshot={includeQuestion:true,includeAnswer:true,includeBase:true,includeAuxiliary:true,questionText:"Synthetic",answerText:"Answer",analysis:"Analysis",basePlan:base,auxiliaryPlan:plan};
  const parsed=parseSolutionSnapshot(JSON.parse(JSON.stringify(snapshot)));expect(parsed).not.toBeNull();
  expect(ConstructionSchema.parse(parsed!.auxiliaryPlan).steps).toEqual(steps);
  await render(<SolutionDocument snapshot={parsed!}/>);
  expect(host.querySelectorAll("[data-aux-circle]")).toHaveLength(2);
 }));
});
