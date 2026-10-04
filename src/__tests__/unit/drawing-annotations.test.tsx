import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import {ConstructionSchema,compileConstruction,BASE_CONSTRUCTION_PROMPT,CONSTRUCTION_PROMPT} from '@/lib/ai-drawing/construction';
import {parseConstructionBase,parseConstructionSteps} from '@/lib/ai-drawing/parse';
import {ConstructionDiagram} from '@/components/construction-diagram';
import {SolutionDocument} from '@/components/solution-document';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
import {solutionPlainText} from '@/lib/solution-share';
import {JobInputSchema} from '@/lib/ai-jobs/schema';
const base={title:'Synthetic marked diagram',points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}],segments:[['O','A'],['O','B']],steps:[]};
const angle={kind:'angle',a:'A',vertex:'O',b:'B',direction:'ccw',text:'1'};
const edge={kind:'segment',a:'O',b:'A',side:'right',text:'4 cm'};
const annotated={...base,annotations:[angle,edge],notes:[{text:'OA与OB有相同等长刻痕',status:'confirmed'},{text:'右上方角值不清晰，请核对原图',status:'uncertain'}]};
const extra={steps:[{description:'Synthetic midpoint',operation:{kind:'midpoint',id:'M',a:'A',b:'B'}}]};
function plan(value:unknown=annotated){return ConstructionSchema.parse(value);}
async function mount(run:(host:HTMLDivElement,render:(node:React.ReactNode)=>Promise<void>)=>Promise<void>){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);try{await run(host,async node=>{await act(async()=>root.render(node));});}finally{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();}}
async function blobText(blob:Blob){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsText(blob);});}
describe('original diagram conditions',()=>{
 it('keeps old plans compatible and new fields bounded and optional',()=>{
  expect(plan(base)).toEqual(base);const parsed=plan();expect(parsed).toEqual(annotated);
  const g=compileConstruction(parsed).geometry;expect(g).toMatchObject({annotations:annotated.annotations,notes:annotated.notes});
 });
 it('accepts marked bases in jobs and share snapshots without losing notes',()=>{
  expect(parseConstructionBase(JSON.stringify(annotated))).toEqual(annotated);
  expect(JobInputSchema.parse({questionText:'synthetic',drawingPlan:annotated}).drawingPlan).toEqual(annotated);
  expect(parseSolutionSnapshot({analysis:'synthetic',basePlan:annotated,includeBase:true})?.basePlan).toEqual(annotated);
 });
 it('inherits markings exactly, never lets stage two replace conditions',()=>{
  const source=plan(),before=JSON.stringify(source),result=parseConstructionSteps(JSON.stringify(extra),source);
  expect(result.annotations).toEqual(source.annotations);expect(result.notes).toEqual(source.notes);expect(JSON.stringify(source)).toBe(before);
  expect(()=>parseConstructionSteps(JSON.stringify({...extra,notes:[]}),source)).toThrow();
  expect(()=>parseConstructionSteps(JSON.stringify({...extra,annotations:[]}),source)).toThrow();
  expect(compileConstruction(result).geometry.annotations).toEqual(compileConstruction(source).geometry.annotations);
 });
 it.each([
  {annotations:[{...angle,vertex:'Z'}]}, {annotations:[{...angle,a:'O'}]},
  {annotations:[{...edge,b:'O'}]}, {annotations:[{...angle,b:'A'}]},
  {annotations:[{...angle,vertex:'M'}],...extra},
 ])('rejects invalid or auxiliary-only anchors %j',change=>{expect(()=>compileConstruction(plan({...base,...change}))).toThrow();});
 it.each([
  {annotations:[{...angle,text:'x'.repeat(25)}]}, {annotations:Array(33).fill(angle)},
  {annotations:[{...angle,text:'\u0000'}]}, {annotations:[{...angle,direction:'auto'}]},
  {annotations:[{...edge,svg:'<path/>'}]}, {notes:[{text:'x',status:'guessed'}]},
  {notes:[{text:'x'.repeat(301),status:'confirmed'}]}, {notes:Array(25).fill({text:'x',status:'confirmed'})},
 ])('rejects unbounded or unknown annotation payload %j',change=>expect(ConstructionSchema.safeParse({...base,...change}).success).toBe(false));
 it('does not inject labels into GeoGebra commands or change source coordinates',()=>{
  const plain=compileConstruction(plan(base)),marked=compileConstruction(plan({...annotated,annotations:[{...edge,text:'<svg onload=x()>"&'}]}));
  expect(marked.base).toEqual(plain.base);expect(marked.geometry.basePoints).toEqual(plain.geometry.basePoints);
 });
 it('prompts distinguish explicit markings from guessed relations and forbid derived conditions',()=>{
  expect(BASE_CONSTRUCTION_PROMPT).toContain('annotations');expect(BASE_CONSTRUCTION_PROMPT).toContain('notes');
  expect(BASE_CONSTRUCTION_PROMPT).toContain('角号');expect(BASE_CONSTRUCTION_PROMPT).toContain('等长刻痕');
  expect(BASE_CONSTRUCTION_PROMPT).toContain('uncertain');expect(BASE_CONSTRUCTION_PROMPT).not.toContain('原图只用于布局对照');
  expect(CONSTRUCTION_PROMPT).toContain('annotations');expect(CONSTRUCTION_PROMPT).toContain('notes');
 });
});
describe('marked drawings and captions',()=>{
 it('renders angular labels in the specified sector and length labels beside a segment',()=>mount(async(host,render)=>{
  await render(<ConstructionDiagram geometry={compileConstruction(plan()).geometry} visible={0} title="synthetic"/>);
  const a=host.querySelector('[data-diagram-annotation="angle"]')!,t=a.querySelector('text')!;
  expect(t.textContent).toBe('1');expect(a.querySelector('path')).not.toBeNull();
  // O maps to (190,460); the ccw A-O-B sector is up/right in SVG coordinates.
  expect(Number(t.getAttribute('x'))).toBeGreaterThan(190);expect(Number(t.getAttribute('y'))).toBeLessThan(460);
  expect(host.querySelector('[data-diagram-annotation="segment"] text')?.textContent).toBe('4 cm');
  const caption=host.querySelector('[data-diagram-caption]')!;expect(caption.textContent).toContain('等长刻痕');expect(caption.textContent).toContain('待核对');expect(caption.textContent).toContain('∠AOB');
  expect(host.querySelector('svg')!.compareDocumentPosition(caption)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 }));
 it('keeps source annotations and viewport fixed through auxiliary steps',()=>mount(async(host,render)=>{
  const source=plan();await render(<ConstructionDiagram geometry={compileConstruction(source).geometry} visible={0} title="s"/>);
  const layer=host.querySelector('[data-layer="base"]')!.outerHTML,box=host.querySelector('svg')!.getAttribute('viewBox');
  const result=parseConstructionSteps(JSON.stringify(extra),source);
  for(const visible of [0,1,0]){await render(<ConstructionDiagram geometry={compileConstruction(result).geometry} visible={visible} title="s"/>);expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(layer);expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(box);}
 }));
 it('retains captions in plain text, image document and cross-tab snapshots, with attachment selection respected',()=>mount(async(host,render)=>{
  const snapshot=parseSolutionSnapshot({analysis:'Synthetic solution',basePlan:annotated,auxiliaryPlan:{...annotated,...extra},includeBase:true,includeAuxiliary:true})!;
  await render(<SolutionDocument snapshot={snapshot}/>);
  expect(host.querySelectorAll('[data-diagram-caption]')).toHaveLength(2);
  for(const includeLatex of [true,false]){const text=solutionPlainText(host,{includeLatex});expect(text).toContain('图片需通过图片分享');expect(text).toContain('等长刻痕');expect(text).toContain('待核对');expect(text).toContain('∠AOB');}
  await render(<SolutionDocument snapshot={{...snapshot,includeBase:false,includeAuxiliary:false}}/>);expect(solutionPlainText(host)).not.toContain('等长刻痕');
 }));
 it('exports captions as inert SVG text below the drawing without changing the embedded viewport',()=>mount(async(host,render)=>{
  const create=vi.fn<(blob:Blob)=>string>(()=>'blob:synthetic');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});vi.spyOn(window,'open').mockReturnValue(null);
  await render(<ConstructionDiagram geometry={compileConstruction(plan({...annotated,notes:[...annotated.notes,{text:'<script>alert(1)</script> & original',status:'confirmed'}]})).geometry} visible={0} title="s"/>);
  const before=host.querySelector('svg')!.getAttribute('viewBox');await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
  const raw=await blobText(create.mock.calls[0][0]),doc=new DOMParser().parseFromString(raw,'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();expect(doc.querySelector('script')).toBeNull();expect(doc.documentElement.textContent).toContain('<script>alert(1)</script>');
  expect(doc.querySelector('[data-export-caption]')?.textContent).toContain('等长刻痕');expect(doc.querySelector('[data-export-caption]')?.textContent).toContain('待核对');
  const [,y,,h]=doc.documentElement.getAttribute('viewBox')!.split(' ').map(Number);for(const t of doc.querySelectorAll('[data-export-caption] text'))expect(Number(t.getAttribute('y'))).toBeLessThan(y+h);
  expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(before);
 }));
});
it('uses clockwise reflex sector rather than silently converting to the minor angle',()=>mount(async(host,render)=>{
 await render(<ConstructionDiagram geometry={compileConstruction(plan({...base,annotations:[{...angle,direction:'cw'}]})).geometry} visible={0} title="cw"/>);
 const g=host.querySelector('[data-diagram-annotation="angle"]')!,t=g.querySelector('text')!;
 expect(Number(t.getAttribute('x'))).toBeLessThan(190);expect(Number(t.getAttribute('y'))).toBeGreaterThan(460);expect(g.querySelector('path')!.getAttribute('d')).toContain(' 1 1 ');
}));
it('retains ambiguous or crowded labels in captions instead of guessing their position',()=>mount(async(host,render)=>{
 const narrow={...base,points:[...base.points,{id:'C',x:4,y:0.1}],annotations:[{...angle,b:'C'}]};
 await render(<ConstructionDiagram geometry={compileConstruction(plan(narrow)).geometry} visible={0} title="crowded"/>);
 expect(host.querySelector('[data-diagram-annotation]')).toBeNull();expect(host.querySelector('[data-diagram-caption]')?.textContent).toContain('∠AOC');expect(host.querySelector('[data-diagram-caption]')?.textContent).toContain('仅在图注保留');
}));
it('supports note-only drawings for conditions not expressible as geometry labels',()=>mount(async(host,render)=>{
 await render(<ConstructionDiagram geometry={compileConstruction(plan({...base,notes:annotated.notes})).geometry} visible={0} title="notes"/>);
 expect(host.querySelector('[data-diagram-annotation]')).toBeNull();expect(host.querySelector('[data-diagram-caption]')?.textContent).toContain('不作为已知条件');
}));
it('includes the full label rectangle in both compact sharing and ordinary crop bounds',()=>mount(async(host,render)=>{
 for(const readOnly of [false,true]){
  await render(<ConstructionDiagram geometry={compileConstruction(plan({...base,annotations:[{...edge,text:'length=4 cm'}]})).geometry} visible={0} title="bounds" readOnly={readOnly} compact/>);
  const svg=host.querySelector('svg')!,[x,y,w,h]=svg.getAttribute('viewBox')!.split(' ').map(Number);
  for(const t of svg.querySelectorAll('[data-diagram-annotation] text')){const tx=Number(t.getAttribute('x')),ty=Number(t.getAttribute('y')),half=t.textContent!.length*9;expect(tx-half).toBeGreaterThan(x);expect(tx+half).toBeLessThan(x+w);expect(ty-14).toBeGreaterThan(y);expect(ty+14).toBeLessThan(y+h);}
 }
}));
