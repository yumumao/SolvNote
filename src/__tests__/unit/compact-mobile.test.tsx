import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ConstructionDiagram} from '@/components/construction-diagram';
import {ConstructionSchema,compileConstruction,BASE_CONSTRUCTION_PROMPT} from '@/lib/ai-drawing/construction';
import {SolutionShare} from '@/components/solution-share';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
import {renderSolutionImages} from '@/lib/solution-images';
vi.mock('@/lib/solution-images',()=>({renderSolutionImages:vi.fn(async()=>[])}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks()});
const plan=ConstructionSchema.parse({title:'合成矩形',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0},{id:'C',x:4,y:3},{id:'D',x:0,y:3}],segments:[['A','B'],['B','C'],['C','D'],['D','A']],annotations:[{kind:'text',x:2,y:1.5,text:'甲'},{kind:'text',x:50,y:30,text:'说明：甲的面积为12cm²'}],steps:[]});
it('keeps remote source text in a compact caption without changing geometry or losing the nearby region label',async()=>{
 const before=JSON.stringify(plan),geometry=compileConstruction(plan).geometry;
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="source"/>));
 const svg=host.querySelector('svg')!,box=svg.getAttribute('viewBox')!,[, ,w,h]=box.split(' ').map(Number);
 expect(w).toBeLessThan(850);expect(h).toBeLessThan(600);
 expect([...host.querySelectorAll('[data-diagram-annotation="text"]')].map(n=>n.textContent)).toEqual(['甲']);
 expect(host.querySelector('[data-diagram-caption]')?.textContent).toContain('说明：甲的面积为12cm²');
 const base=host.querySelector('[data-layer="base"]')!.outerHTML;
 const next=compileConstruction({...plan,steps:[{description:'取中点',operation:{kind:'midpoint',id:'M',a:'A',b:'B'}}]}).geometry;
 for(const visible of [0,1,0]){await act(async()=>root.render(<ConstructionDiagram geometry={next} visible={visible} title="source"/>));expect(host.querySelector('[data-layer="base"]')!.outerHTML).toBe(base);expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(box);}
 expect(JSON.stringify(plan)).toBe(before);
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="share" readOnly compact/>));
 expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(box);expect(host.textContent).toContain('说明：甲的面积为12cm²');
});
it('allows compact source typography while keeping orientation and locked-stage protection',()=>{
 expect(BASE_CONSTRUCTION_PROMPT).toContain('不必照搬原图的空白间距');
 expect(BASE_CONSTRUCTION_PROMPT).toContain('不得整体旋转、镜像或翻转');
 expect(BASE_CONSTRUCTION_PROMPT).not.toContain('按原图位置放置');
});
const button=(name:string)=>[...host.querySelectorAll('button')].find(n=>n.textContent===name)!;
it.each([true,false])('defaults a new share to narrow-screen fitting and passes the same selection to image export (narrow=%s)',async narrow=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:narrow})));
 await act(async()=>root.render(<SolutionShare analysis="合成题解"/>));
 await act(async()=>button('分享解题过程').click());
 expect(host.querySelector('[data-solution-document]')?.getAttribute('data-fit-width')).toBe(String(narrow));
 await act(async()=>button('生成分享长图').click());
 expect(vi.mocked(renderSolutionImages).mock.calls.at(-1)![0].dataset.fitWidth).toBe(String(narrow));
 const toggle=host.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
 await act(async()=>toggle.click());
 await act(async()=>root.render(<SolutionShare analysis="合成题解"/>));
 expect(host.querySelector('[data-solution-document]')?.getAttribute('data-fit-width')).toBe(String(!narrow));
});
it('retains an explicitly restored original-width snapshot on a small screen',async()=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true})));
 const snapshot=parseSolutionSnapshot({analysis:'合成',fitWidth:false})!;
 await act(async()=>root.render(<SolutionShare {...snapshot} initialSelection={snapshot} inline/>));
 expect(host.querySelector('[data-solution-document]')?.getAttribute('data-fit-width')).toBe('false');
});
