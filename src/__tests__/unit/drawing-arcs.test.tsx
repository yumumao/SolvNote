import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,it,expect,vi} from "vitest";
import {ConstructionSchema,compileConstruction,CONSTRUCTION_PROMPT} from "@/lib/ai-drawing/construction";
import {DrawingResultPreview} from "@/components/auxiliary-drawing";
vi.mock("@/components/geogebra-demo",()=>({GeogebraDemo:()=>null}));
const plan={title:"合成圆弧底图",points:[{id:"O",x:0,y:0},{id:"A",x:4,y:0},{id:"B",x:0,y:4},{id:"C",x:-4,y:0}],segments:[],arcs:[{center:"O",start:"A",end:"B",direction:"ccw",sector:true},{center:"O",start:"A",end:"C",direction:"cw"}],steps:[{description:"连接弦",operation:{kind:"segment",a:"A",b:"B"}}]};
describe("bounded circular arc foundations",()=>{
 it("compiles quarter sectors and clockwise semicircles, without silently substituting full circles",()=>{
  const result=compileConstruction(ConstructionSchema.parse(plan));
  expect(result.base).toContain('baseArc0=CircularSector(O,A,B)');expect(result.base).toContain('baseArc1=CircularArc(O,C,A)');
  expect(result.base).toContain('SetFilling(baseArc0,0)');expect(result.geometry.arcs).toHaveLength(2);expect(result.geometry.arcs[0].span).toBeCloseTo(Math.PI/2);expect(result.geometry.arcs[1].span).toBeCloseTo(Math.PI);
 });
 it("rejects mismatched radii, missing points, coincident endpoints and arbitrary directions",()=>{
  for(const arc of [{center:'O',start:'A',end:'Z',direction:'ccw'},{center:'O',start:'A',end:'A',direction:'ccw'},{center:'O',start:'A',end:'B',direction:'eval()'}])expect(()=>compileConstruction(ConstructionSchema.parse({...plan,arcs:[arc]}))).toThrow();
  expect(()=>compileConstruction(ConstructionSchema.parse({...plan,points:plan.points.map(p=>p.id==='B'?{...p,y:3}:p)}))).toThrow();
  expect(()=>ConstructionSchema.parse({...plan,arcs:Array(25).fill(plan.arcs[0])})).toThrow();
 });
 it("renders directed SVG arcs and sector boundaries at step zero",async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
  try{await act(async()=>root.render(<DrawingResultPreview result={{type:'construction',plan}}/>));expect(host.querySelectorAll('path[data-base-arc]')).toHaveLength(2);expect(host.querySelector('path[data-base-arc]')?.getAttribute('d')).toMatch(/ A .* 0 0 0 /);expect(host.querySelectorAll('path[data-base-arc]')[1].getAttribute('d')).toMatch(/ A .* 0 0 1 /);
   const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='上一步')!;await act(async()=>button.click());expect(host.querySelectorAll('path[data-base-arc]')).toHaveLength(2);expect(host.querySelectorAll('line')).toHaveLength(2);
  }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
 });
 it("asks for supported arcs and does not demand an exact shaded-region reconstruction",()=>{expect(CONSTRUCTION_PROMPT).toContain('"arcs"');expect(CONSTRUCTION_PROMPT).toContain('阴影');});
});
