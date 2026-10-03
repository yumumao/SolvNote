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
  const createObjectURL=vi.fn((_blob:Blob)=>"blob:construction");
  vi.stubGlobal("URL",{createObjectURL,revokeObjectURL:vi.fn()});
  const open=vi.spyOn(window,"open").mockReturnValue(null);
  const anchorClick=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  const completed:ConstructionPlan={...base,steps:[{description:"outlying copy",operation:{kind:"rotate",id:"P",point:"B",center:"A",degrees:180}}]};
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<ConstructionDiagram geometry={compileConstruction(completed).geometry} visible={1} title={base.title}/>));
   expect(host.querySelector('[data-outside-note]')?.textContent).toContain("新标签页打开");
   await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
   expect(anchorClick).not.toHaveBeenCalled();expect(open).toHaveBeenCalledTimes(1);expect(createObjectURL).toHaveBeenCalledTimes(1);expect(open).toHaveBeenCalledWith("blob:construction","_blank","noopener,noreferrer");
   const blob=createObjectURL.mock.calls[0][0] as Blob;const serialized=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(blob);});expect(serialized).toContain('viewBox="');expect(serialized).not.toContain('viewBox="0 0 800 500"');
   const exported=new DOMParser().parseFromString(serialized,"image/svg+xml").documentElement;
   expect(exported.localName,exported.textContent ?? "").toBe("svg");
   expect(exported.getAttribute("style")).not.toContain("max-height");
   expect(exported.getAttribute("style")).not.toContain("max-width");
   expect(exported.getAttribute("width")).toBe("100%");expect(exported.getAttribute("height")).toBe("100%");
   expect(host.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 800 500");
  }finally{await act(async()=>root.unmount());open.mockRestore();anchorClick.mockRestore();vi.unstubAllGlobals();}
 });});
