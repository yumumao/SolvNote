import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,expect,it,vi} from "vitest";
import {ConstructionDiagram} from "@/components/construction-diagram";
import {compileConstruction,type ConstructionPlan} from "@/lib/ai-drawing/construction";
const base:ConstructionPlan={title:"Locked source",points:[{id:"O",x:0,y:0},{id:"A",x:4,y:0},{id:"B",x:0,y:4}],segments:[["O","A"],["O","B"]],circles:[{center:"O",through:"A"}],arcs:[{center:"O",start:"A",end:"B",direction:"ccw",sector:true}],steps:[]};
describe("source-to-auxiliary pixel invariants",()=>{
 it("never refits the source when an outlying auxiliary point is added or removed",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host);
  const getBase=()=>host.querySelector('[data-layer="base"]')!.outerHTML;
  try{
   await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(base).geometry} visible={0} title={base.title}/>));
   const source=getBase(),viewBox=host.querySelector("svg")!.getAttribute("viewBox");
   const completed:ConstructionPlan={...base,steps:[{description:"copy",operation:{kind:"rotate",id:"C",point:"B",center:"A",degrees:180}}]};
   for(const visible of [0,1,0,1]){
    await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(completed).geometry} visible={visible} title={base.title}/>));
    expect(getBase()).toBe(source);expect(host.querySelector("svg")!.getAttribute("viewBox")).toBe(viewBox);
   }
   await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(base).geometry} visible={0} title={base.title}/>));
   expect(getBase()).toBe(source);
  }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
 }); it("offers the complete current-step drawing in a new tab without changing the fixed viewport",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const createObjectURL=vi.fn<(blob:Blob)=>string>(()=>"blob:construction");
  vi.stubGlobal("URL",{createObjectURL,revokeObjectURL:vi.fn()});
  const open=vi.spyOn(window,"open").mockReturnValue(null);
  const anchorClick=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  const completed:ConstructionPlan={...base,steps:[{description:"outlying copy",operation:{kind:"rotate",id:"P999",point:"B",center:"A",degrees:180}}]};
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(completed).geometry} visible={1} title={base.title}/>));
   const embeddedViewBox=host.querySelector("svg")!.getAttribute("viewBox");
   expect(host.querySelector('[data-outside-note]')?.textContent).toContain("新标签页打开");
   await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
   expect(anchorClick).not.toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);expect(createObjectURL).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledWith("blob:construction","_blank","noopener,noreferrer");
   const blob=createObjectURL.mock.calls[0][0] as Blob;const serialized=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(blob);});expect(serialized).toContain('viewBox="');expect(serialized).not.toContain('viewBox="0 0 800 500"');
   const exported=new DOMParser().parseFromString(serialized,"image/svg+xml").documentElement;
   expect(exported.localName,exported.textContent ?? "").toBe("svg");
   const [left,,width]=exported.getAttribute("viewBox")!.split(" ").map(Number);
   const label=exported.querySelector('[data-aux-point="P999"] text')!;
   expect(left+width).toBeGreaterThan(Number(label.getAttribute("x"))+72);
   expect(exported.getAttribute("style")).not.toContain("max-height");
   expect(exported.getAttribute("style")).not.toContain("max-width");
   expect(exported.getAttribute("width")).toBe("100%");expect(exported.getAttribute("height")).toBe("100%");
   expect(host.querySelector("svg")!.getAttribute("viewBox")).toBe(embeddedViewBox);
  }finally{await act(async()=>root.unmount());open.mockRestore();anchorClick.mockRestore();vi.unstubAllGlobals();}
 });});


// Ordinary previews trim only the locked source bounds. Step changes cannot refit them.
it.each(['cw','ccw'] as const)('trims the ordinary %s quarter-circle without refitting between jobs or steps',async direction=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const source:ConstructionPlan={...base,circles:[],arcs:[{center:'O',start:direction==='ccw'?'A':'B',end:direction==='ccw'?'B':'A',direction,sector:true}]};
 try{
  await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(source).geometry} visible={0} title="quarter"/>));
  const svg=host.querySelector('svg')!,locked=svg.getAttribute('viewBox')!,layer=host.querySelector('[data-layer="base"]')!.outerHTML;
  const [x,y,w,h]=locked.split(' ').map(Number);
  expect(w).toBeLessThan(290);expect(h).toBeLessThan(290);
  expect(x).toBeLessThan(396);expect(y).toBeLessThan(10);expect(x+w).toBeGreaterThan(639);expect(y+h).toBeGreaterThan(254);
  expect(Number.parseFloat(svg.style.maxWidth)).toBeLessThanOrEqual(w);
  const completed:ConstructionPlan={...source,steps:[{description:'outside the crop but inside old canvas',operation:{kind:'rotate',id:'P999',point:'B',center:'O',degrees:180}}]};
  for(const visible of [0,1,0,1]){
   await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(completed).geometry} visible={visible} title="quarter"/>));
   expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(locked);
   expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(layer);
   expect(!!host.querySelector('[data-outside-note]')).toBe(visible===1);
   expect(host.querySelector('[data-open-full-image]')).not.toBeNull();
  }
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it.each(['horizontal','vertical'] as const)('removes %s canvas whitespace without clipping four-character labels or creating height-cap letterboxing',async direction=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const plan:ConstructionPlan={title:'line',points:[{id:'A',x:0,y:0},{id:'B123',x:direction==='horizontal'?4:0,y:direction==='vertical'?4:0}],segments:[['A','B123']],steps:[]};
 try{
  await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(plan).geometry} visible={0} title="line"/>));
  const svg=host.querySelector('svg')!,[x,y,w,h]=svg.getAttribute('viewBox')!.split(' ').map(Number);
  expect(direction==='horizontal'?h:w).toBeLessThan(115);
  const label=host.querySelector('[data-base-point="B123"] text')!;
  expect(x+w).toBeGreaterThan(Number(label.getAttribute('x'))+72);expect(y).toBeLessThan(Number(label.getAttribute('y'))-18);
  const width=Number.parseFloat(svg.style.maxWidth);
  expect(width).toBeLessThanOrEqual(Math.min(800,w));expect(width*h/w).toBeLessThanOrEqual(500);
  expect(host.querySelector('[data-outside-note]')).toBeNull();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
