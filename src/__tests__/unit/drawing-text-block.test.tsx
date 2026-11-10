import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
vi.mock('@/components/geogebra-demo',()=>({GeogebraDemo:()=>null}));
import {AuxiliaryDrawing,DrawingResultPreview,ConstructionPreview} from '@/components/auxiliary-drawing';
import {SolutionDocument} from '@/components/solution-document';
import {ConstructionSchema} from '@/lib/ai-drawing/construction';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
import {apiClient} from '@/lib/api-client';
import type {BaseDrawingCache} from '@/lib/ai-drawing/base-reuse';
const question='图外说明：白色部分为道路。\n\n求阴影面积，结果保留平方厘米。';
const base=ConstructionSchema.parse({title:'Synthetic legacy drawing',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0},{id:'C',x:0,y:3}],segments:[['A','B'],['A','C']],steps:[]});
const aux=ConstructionSchema.parse({...base,steps:[{description:'Connect B and C',operation:{kind:'segment',a:'B',b:'C'}}]});
const input={questionText:question,answerText:'synthetic answer',analysis:'synthetic analysis'};
async function mount(run:(host:HTMLDivElement,render:(node:React.ReactNode)=>Promise<void>)=>Promise<void>){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);try{await run(host,async node=>{await act(async()=>root.render(node));});}finally{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();}}
const click=async(host:HTMLElement,name:string)=>{await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===name)!.click();});};
it('places existing question text beneath a legacy base without changing geometry or calling AI',()=>mount(async(host,render)=>{
 const post=vi.spyOn(apiClient,'post'),saved=JSON.stringify(base);
 await render(<AuxiliaryDrawing {...input} initialBase={base}/>);
 const svg=host.querySelector('svg')!,text=host.querySelector('[data-diagram-source-text]')!;
 expect(text?.textContent).toContain('图外说明');expect(text?.textContent).toContain('平方厘米');
 expect(svg.compareDocumentPosition(text)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(post).not.toHaveBeenCalled();expect(JSON.stringify(base)).toBe(saved);
}));
it('shows the question even when a freshly generated response omits all text fields',()=>mount(async(host,render)=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);const post=vi.spyOn(apiClient,'post').mockResolvedValue({type:'construction',plan:base});
 await render(<AuxiliaryDrawing {...input}/>);await click(host,'第一步：生成原题底图');
 expect(host.querySelector('[data-diagram-source-text]')?.textContent).toContain('图外说明');expect(post).toHaveBeenCalledTimes(1);
}));
it('adds text to reused legacy drawings with no new request',()=>mount(async(host,render)=>{
 const post=vi.spyOn(apiClient,'post');const cache={lookup:vi.fn(()=>({plan:base,correction:''})),remember:vi.fn(),invalidate:vi.fn()} as unknown as BaseDrawingCache;
 await render(<AuxiliaryDrawing {...input} baseDrawingCache={cache}/>);await click(host,'第一步：生成原题底图');
 expect(host.querySelector('[data-diagram-source-text]')?.textContent).toContain('图外说明');expect(post).not.toHaveBeenCalled();
}));
it('keeps the old drawing paired with its original text after the editor changes to another question',()=>mount(async(host,render)=>{
 await render(<AuxiliaryDrawing {...input} initialBase={base}/>);
 await render(<AuxiliaryDrawing {...input} questionText="另一道题的文字" initialBase={base}/>);
 expect(host.querySelector('[data-diagram-source-text]')?.textContent).toContain('图外说明');
 expect(host.querySelector('[data-diagram-source-text]')?.textContent).not.toContain('另一道题');
}));
it.each([base,aux])('uses the stored task input when recovering a legacy drawing ($steps.length steps)',plan=>mount(async(host,render)=>{
 await render(<DrawingResultPreview result={{type:'construction',plan}} input={input}/>);
 expect(host.querySelector('[data-diagram-source-text]')?.textContent).toContain('图外说明');
}));
it('shares old drawings with question fallback, deduplicates auxiliary copies and keeps saved differing text',()=>mount(async(host,render)=>{
 const snapshot=parseSolutionSnapshot({...input,basePlan:base,auxiliaryPlan:aux,includeBase:true,includeAuxiliary:true,includeQuestion:false})!;
 await render(<SolutionDocument snapshot={snapshot}/>);
 expect(host.querySelectorAll('[data-diagram-source-text]')).toHaveLength(1);expect(host.textContent?.match(/图外说明/g)).toHaveLength(1);
 await render(<SolutionDocument snapshot={{...snapshot,includeBase:false}}/>);expect(host.querySelector('[data-diagram-source-text]')?.textContent).toContain('图外说明');
 await render(<SolutionDocument snapshot={{...snapshot,includeQuestion:true}}/>);expect(host.querySelector('[data-diagram-source-text]')).toBeNull();expect(host.textContent?.match(/图外说明/g)).toHaveLength(1);
 await render(<SolutionDocument snapshot={{...snapshot,basePlan:{...base,sourceText:'已保存的其他文字'}}}/>);expect(host.querySelectorAll('[data-diagram-source-text]')).toHaveLength(2);expect(host.textContent).toContain('已保存的其他文字');
}));
it('includes fallback question text in standalone SVG without new AI or unsafe XML',()=>mount(async(host,render)=>{
 const create=vi.fn<(blob:Blob)=>string>(()=>'blob:synthetic');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});vi.spyOn(window,'open').mockReturnValue(null);
 await render(<DrawingResultPreview result={{type:'construction',plan:base}} input={{...input,questionText:question+'\uffff\u0000'}}/>);
 await act(async()=>{host.querySelector<HTMLButtonElement>('[data-open-full-image]')!.click();});
 const raw=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsText(create.mock.calls[0][0]);});
 const doc=new DOMParser().parseFromString(raw,'image/svg+xml');expect(doc.querySelector('parsererror')).toBeNull();expect(doc.querySelector('[data-export-caption]')?.textContent).toContain('图外说明');expect(doc.querySelector('[data-export-caption]')?.textContent).toContain('平方厘米');
}));
it('does not invent a text block when neither the drawing nor its context contains text',()=>mount(async(host,render)=>{
 await render(<ConstructionPreview plan={base}/>);expect(host.querySelector('[data-diagram-source-text]')).toBeNull();
}));
