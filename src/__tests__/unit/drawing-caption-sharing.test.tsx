import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import {SolutionDocument} from '@/components/solution-document';
import {ConstructionDiagram} from '@/components/construction-diagram';
import {ConstructionSchema,compileConstruction} from '@/lib/ai-drawing/construction';
import {diagramConditionLines} from '@/lib/ai-drawing/annotations';
import {parseSolutionSnapshot,type SolutionSnapshot} from '@/lib/solution-snapshot';
import {solutionPlainText,solutionUnits} from '@/lib/solution-share';
const base=ConstructionSchema.parse({title:'Synthetic source',points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}],segments:[['O','A'],['O','B']],annotations:[{kind:'angle',a:'A',vertex:'O',b:'B',direction:'ccw',text:'1'}],notes:[{status:'confirmed',text:'人工补充1（较新说明优先）：OA与OB有相同等长刻痕'},{status:'uncertain',text:'右侧角值待确认'}],steps:[]});
const auxiliary=ConstructionSchema.parse({...base,steps:[{description:'取AB中点M作为辅助构造。',operation:{kind:'midpoint',id:'M',a:'A',b:'B'}}]});
function snapshot(patch:Partial<SolutionSnapshot>={}){return parseSolutionSnapshot({analysis:'Synthetic solution',basePlan:base,auxiliaryPlan:auxiliary,includeBase:true,includeAuxiliary:true,...patch})!;}
async function mount(run:(host:HTMLDivElement,render:(node:React.ReactNode)=>Promise<void>)=>Promise<void>){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);try{await run(host,async node=>{await act(async()=>root.render(node));});}finally{await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();}}
const section=(host:HTMLElement,title:string)=>Array.from(host.querySelectorAll<HTMLElement>('[data-solution-section]')).find(e=>e.querySelector('h2')?.textContent===title)!;
const sourceSection=(host:HTMLElement)=>section(host,'原题重绘');
const auxSection=(host:HTMLElement)=>section(host,'辅助线图');
describe('reading and sharing diagram caption ownership',()=>{
 it('shows confirmed condition text without repeating the shared verification heading',()=>{
  const notes=[{status:'confirmed' as const,text:'OA与OB等长'},{status:'confirmed' as const,text:'半圆位于AB上方'},{status:'uncertain' as const,text:'角值未确定'}];
  expect(diagramConditionLines([],notes)).toEqual(['OA与OB等长','半圆位于AB上方','待核对（不作为已知条件）：角值未确定']);
 });
 it('shows inherited source conditions once beneath the redraw without removing image labels',()=>mount(async(host,render)=>{
  await render(<SolutionDocument snapshot={snapshot()}/>);
  expect(host.querySelectorAll('[data-diagram-caption]')).toHaveLength(1);expect(host.textContent).toContain('识别结果，请核对原图');expect(host.textContent).not.toContain('原图条件（请对照原图核验）');
  expect(sourceSection(host).textContent).toContain('等长刻痕');expect(auxSection(host).textContent).not.toContain('等长刻痕');
  expect(auxSection(host).querySelectorAll('[data-diagram-annotation]')).toHaveLength(1);
 }));
 it('retains full conditions with auxiliary only and updates on attachment toggles',()=>mount(async(host,render)=>{
  for(const includeBase of [false,true,false]){await render(<SolutionDocument snapshot={snapshot({includeBase})}/>);expect(auxSection(host).textContent?.includes('等长刻痕')).toBe(!includeBase);expect(host.querySelectorAll('[data-diagram-caption]')).toHaveLength(1);}
 }));
 it('retains auxiliary-only and differently qualified source notes',()=>mount(async(host,render)=>{
  const extra=ConstructionSchema.parse({...auxiliary,notes:[...auxiliary.notes!,{status:'uncertain',text:'OA与OB有相同等长刻痕'},{status:'confirmed',text:'第二份图的独有条件'}]});
  await render(<SolutionDocument snapshot={snapshot({auxiliaryPlan:extra})}/>);
  expect(auxSection(host).textContent).toContain('待核对（不作为已知条件）：OA与OB有相同等长刻痕');expect(auxSection(host).textContent).toContain('第二份图的独有条件');expect(auxSection(host).textContent).not.toContain('右侧角值待确认');
 }));
 it('puts explicit auxiliary descriptions below step two as inert text',()=>mount(async(host,render)=>{
  const description='连接OM，<script>alert(1)</script>，仅为辅助构造';
  await render(<SolutionDocument snapshot={snapshot({auxiliaryPlan:{...auxiliary,steps:[{...auxiliary.steps[0],description}]}})}/>);
  const note=auxSection(host).querySelector('[data-auxiliary-caption]')!;expect(note).not.toBeNull();expect(note.textContent).toContain(description);expect(note.querySelector('script')).toBeNull();expect(sourceSection(host).textContent).not.toContain(description);
  expect(auxSection(host).querySelector('svg')!.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(note.textContent).toContain('辅助线图注');
 }));
 it('keeps text share and PNG units consistent with the visible selection',()=>mount(async(host,render)=>{
  await render(<SolutionDocument snapshot={snapshot()}/>);
  for(const includeLatex of [true,false]){const text=solutionPlainText(host,{includeLatex});expect(text.match(/等长刻痕/g)).toHaveLength(1);expect(text).not.toContain('人工补充1');expect(text).toContain('取AB中点M');expect(text).toContain('图片需通过图片分享');}
  const parts=solutionUnits(host.querySelector('[data-solution-document]') as HTMLElement).map(e=>e.textContent).join('');expect(parts.match(/等长刻痕/g)).toHaveLength(1);expect(parts).toContain('取AB中点M');
 }));
 it('does not mutate stored notes, geometry, snapshot handoff or evidence order',()=>mount(async(host,render)=>{
  const value=snapshot(),before=JSON.stringify(value);await render(<SolutionDocument snapshot={value}/>);expect(JSON.stringify(value)).toBe(before);expect(parseSolutionSnapshot(value)?.basePlan?.notes?.[0].text).toContain('人工补充1（较新说明优先）');
 }));
 it('keeps legacy plans and deselected diagrams clean',()=>mount(async(host,render)=>{
  const old=ConstructionSchema.parse({...base,annotations:undefined,notes:undefined});await render(<SolutionDocument snapshot={snapshot({basePlan:old,auxiliaryPlan:{...old,steps:auxiliary.steps}})}/>);expect(host.querySelector('[data-diagram-caption]')).toBeNull();expect(host.querySelector('[data-auxiliary-caption]')).not.toBeNull();
  await render(<SolutionDocument snapshot={snapshot({includeBase:false,includeAuxiliary:false})}/>);expect(host.querySelector('[data-diagram-caption]')).toBeNull();expect(host.querySelector('[data-auxiliary-caption]')).toBeNull();
 }));
 it('retains crowded-angle conditions once without duplicate fallback captions',()=>mount(async(host,render)=>{
  const narrow={...base,points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:4,y:0.1}]};await render(<SolutionDocument snapshot={snapshot({basePlan:narrow,auxiliaryPlan:{...narrow,steps:auxiliary.steps}})}/>);
  expect(host.querySelectorAll('[data-diagram-caption]')).toHaveLength(1);expect(sourceSection(host).textContent).toContain('仅在图注保留');expect(auxSection(host).querySelector('[data-diagram-caption]')).toBeNull();
 }));
 it('strips only known provenance prefixes, retaining excerpt and uncertainty warnings',()=>{
  const lines=diagramConditionLines([], [{status:'confirmed',text:'人工补充2（较新说明优先，此处为摘要，完整内容见角标核对区）：摘要内容…'},{status:'uncertain',text:'人工补充3（较新说明优先）：未确定的角'},{status:'confirmed',text:'原文提到人工补充1（较新说明优先）：此处不是前缀'}]);
  expect(lines[0]).not.toContain('人工补充2');expect(lines[0]).not.toContain('较新说明优先');expect(lines[0]).toContain('摘要内容…');expect(lines[0]).toContain('此处为摘要，完整内容见角标核对区');expect(lines[1]).toBe('待核对（不作为已知条件）：未确定的角');expect(lines[2]).toContain('原文提到人工补充1（较新说明优先）');
 });
 it('uses the same cleaned caption in ordinary diagrams',()=>mount(async(host,render)=>{
  await render(<ConstructionDiagram geometry={compileConstruction(base).geometry} visible={0} title="synthetic"/>);const note=host.querySelector('[data-diagram-caption]')!;expect(note.textContent).toContain('等长刻痕');expect(note.textContent).not.toContain('人工补充1');expect(note.textContent).toContain('不作为已知条件');expect(note.textContent).toContain('识别结果，请核对原图');expect(note.textContent).not.toContain('原图条件（请对照原图核验）');
 }));
});
it('exports a self-contained standalone SVG even when embedded source captions are suppressed',()=>mount(async(host,render)=>{
 const create=vi.fn<(blob:Blob)=>string>(()=>'blob:synthetic');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});vi.spyOn(window,'open').mockReturnValue(null);
 await render(<ConstructionDiagram geometry={compileConstruction(auxiliary).geometry} visible={1} title="synthetic" shownConditionLines={diagramConditionLines(base.annotations||[],base.notes||[])}/>);
 expect(host.querySelector('[data-diagram-caption]')).toBeNull();
 await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
 const raw=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsText(create.mock.calls[0][0]);});
 const doc=new DOMParser().parseFromString(raw,'image/svg+xml'),caption=doc.querySelector('[data-export-caption]')!;
 expect(caption.textContent).toContain('等长刻痕');expect(caption.textContent).toContain('不作为已知条件');expect(caption.textContent).not.toContain('人工补充1');expect(caption.textContent).toContain('识别结果，请核对原图');expect(caption.textContent).not.toContain('原图条件（请对照原图核验）');expect(doc.querySelector('parsererror')).toBeNull();
}));
it('renders no auxiliary descriptions when only the redraw is selected',()=>mount(async(host,render)=>{
 await render(<SolutionDocument snapshot={snapshot({includeAuxiliary:false})}/>);expect(host.querySelector('[data-auxiliary-caption]')).toBeNull();expect(host.querySelectorAll('[data-diagram-caption]')).toHaveLength(1);
}));
it('keeps original caption text compact, inert and present once in combined sharing',()=>mount(async(host,render)=>{
 const sourceCaptions=['图1：甲为草地，乙为道路。','长图注'.repeat(80)+'完整结尾','<script>literal caption</script>'];
 const value=snapshot({basePlan:{...base,sourceCaptions},auxiliaryPlan:{...auxiliary,sourceCaptions}});
 await render(<SolutionDocument snapshot={snapshot()}/>);
 const originalViewBox=sourceSection(host).querySelector('svg')!.getAttribute('viewBox');
 await render(<SolutionDocument snapshot={value}/>);
 expect(sourceSection(host).querySelector('svg')!.getAttribute('viewBox')).toBe(originalViewBox);
 expect(host.querySelector('script')).toBeNull();
 for(const text of sourceCaptions){expect(sourceSection(host).textContent).toContain(text);expect(auxSection(host).textContent).not.toContain(text);}
 const plain=solutionPlainText(host,{includeLatex:false});expect(plain.match(/图1：甲为草地/g)).toHaveLength(1);expect(plain).toContain('完整结尾');
 await render(<SolutionDocument snapshot={{...value,includeBase:false}}/>);
 expect(auxSection(host).textContent).toContain('完整结尾');expect(auxSection(host).textContent).toContain('原图识读文字（待核对）');
}));
it('exports the full wrapped source caption inside the standalone SVG without widening geometry',()=>mount(async(host,render)=>{
 const caption='图注原文'.repeat(75)+'最终单位平方厘米';
 const create=vi.fn<(blob:Blob)=>string>(()=>'blob:caption');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});vi.spyOn(window,'open').mockReturnValue(null);
 const exported=async(index:number)=>{
  const raw=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsText(create.mock.calls[index][0]);});
  return new DOMParser().parseFromString(raw,'image/svg+xml');
 };
 await render(<ConstructionDiagram geometry={compileConstruction(base).geometry} visible={0} title="synthetic"/>);
 await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
 const withoutCaption=await exported(0);
 await render(<ConstructionDiagram geometry={compileConstruction({...base,sourceCaptions:[caption]}).geometry} visible={0} title="synthetic"/>);
 const initial=host.querySelector('svg')!.getAttribute('viewBox');
 await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
 const doc=await exported(1);
 expect(doc.querySelector('[data-export-caption]')!.textContent).toContain(caption);expect(doc.querySelector('parsererror')).toBeNull();
 expect(doc.documentElement.getAttribute('viewBox')!.split(' ')[2]).toBe(withoutCaption.documentElement.getAttribute('viewBox')!.split(' ')[2]);
 expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(initial);
}));
it('includes exterior question text with the drawing even when the separate question is not selected',()=>mount(async(host,render)=>{
 const sourceText='图外题文：一块长方形草地，长为12米。\n\n求阴影面积，保留单位。';
 const value=snapshot({questionText:sourceText,includeQuestion:false,basePlan:{...base,sourceText},auxiliaryPlan:{...auxiliary,sourceText}});
 await render(<SolutionDocument snapshot={snapshot()}/>);const before=sourceSection(host).querySelector('svg')!.getAttribute('viewBox');
 await render(<SolutionDocument snapshot={value}/>);
 expect(sourceSection(host).querySelector('[data-diagram-source-text]')!.textContent).toContain('图外题文');
 expect(sourceSection(host).querySelector('svg')!.getAttribute('viewBox')).toBe(before);
 expect(host.querySelectorAll('[data-diagram-source-text]')).toHaveLength(1);
 expect(solutionPlainText(host,{includeLatex:false}).match(/图外题文/g)).toHaveLength(1);
 await render(<SolutionDocument snapshot={{...value,includeBase:false}}/>);expect(auxSection(host).textContent).toContain('图外题文');
 await render(<SolutionDocument snapshot={{...value,includeQuestion:true}}/>);
 expect(host.querySelectorAll('[data-diagram-source-text]')).toHaveLength(0);expect(host.textContent?.match(/图外题文/g)).toHaveLength(1);
}));
it('does not hide differing source text and never loads remote Markdown content from a drawing',()=>mount(async(host,render)=>{
 const sourceText='外侧说明，$\\frac{1}{2}$。\n\n![图片](https://invalid.example/test.png)\n\n[链接](https://invalid.example)';
 await render(<SolutionDocument snapshot={snapshot({includeQuestion:true,questionText:'较新题干',basePlan:{...base,sourceText},auxiliaryPlan:{...auxiliary,sourceText:'另一张图的说明'}})}/>);
 expect(host.querySelectorAll('[data-diagram-source-text]')).toHaveLength(2);expect(sourceSection(host).textContent).toContain('外侧说明');
 expect(sourceSection(host).querySelector('.katex')).not.toBeNull();expect(sourceSection(host).querySelector('img')).toBeNull();expect(sourceSection(host).querySelector('a')).toBeNull();
}));
it('standalone SVG retains the full exterior text even when the embedding suppresses its duplicate',()=>mount(async(host,render)=>{
 const sourceText='图外第一段：'+('甲乙丙丁'.repeat(100))+'\n图外第二段：全文结束\ufffe';
 const create=vi.fn<(blob:Blob)=>string>(()=>'blob:exterior');vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:vi.fn()});vi.spyOn(window,'open').mockReturnValue(null);
 await render(<ConstructionDiagram geometry={compileConstruction({...base,sourceText}).geometry} visible={0} title="synthetic" shownSourceTexts={[sourceText]}/>);
 expect(host.querySelector('[data-diagram-source-text]')).toBeNull();
 await act(async()=>{(host.querySelector('[data-open-full-image]') as HTMLButtonElement).click();});
 const raw=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsText(create.mock.calls[0][0]);});
 const doc=new DOMParser().parseFromString(raw,'image/svg+xml'),caption=doc.querySelector('[data-export-caption]')!;
 expect(caption.textContent).toContain(sourceText.replace('\n','').replace('\ufffe','\ufffd'));expect(caption.textContent).toContain('题干与图外文字');expect(doc.querySelector('parsererror')).toBeNull();
}));
it('deduplicates locally cleaned source text against the same pasted question',()=>mount(async(host,render)=>{
 const sourceText='首段\n第二段';
 await render(<SolutionDocument snapshot={snapshot({includeQuestion:true,questionText:'首段\f第二段\u202e',basePlan:{...base,sourceText},auxiliaryPlan:{...auxiliary,sourceText}})}/>);
 expect(host.querySelector('[data-diagram-source-text]')).toBeNull();expect(host.textContent?.match(/第二段/g)).toHaveLength(1);
}));
