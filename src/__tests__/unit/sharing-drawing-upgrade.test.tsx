import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConstructionSchema,compileConstruction,BASE_CONSTRUCTION_PROMPT} from '@/lib/ai-drawing/construction';
import {ConstructionDiagram} from '@/components/construction-diagram';
import {SolutionDocument} from '@/components/solution-document';
import {parseSolutionSnapshot} from '@/lib/solution-snapshot';
import {sameBaseDrawing} from '@/lib/ai-drawing/base-comparison';
import {renderSolutionImages} from '@/lib/solution-images';
import {solutionImageWidth} from '@/lib/markdown-fit';
import {generateGradeInstruction} from '@/lib/ai/prompts';
import {solvePrompt} from '@/lib/ai-dialogue/protocol';
import {toBlob} from 'html-to-image';
import {parseConstructionSteps} from '@/lib/ai-drawing/parse';
import {diagramRegionPath} from '@/lib/ai-drawing/regions';
vi.mock('html-to-image',()=>({toBlob:vi.fn(async()=>new Blob(['synthetic'],{type:'image/png'}))}));
const source={title:'合成图',points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}],segments:[['O','A'],['O','B']],steps:[]};
const region={contours:[{start:'O',edges:[{kind:'segment',to:'A'},{kind:'arc',center:'O',to:'B',direction:'ccw'},{kind:'segment',to:'O'}]}]};
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals()});
describe('source shading and labels',()=>{
 it('compiles a shaded sector and renders it beneath the original edges with arbitrary literal labels',()=>{
  const plan=ConstructionSchema.parse({...source,regions:[region],annotations:[{kind:'text',x:1,y:1,text:'阴影甲：12cm²'}]});
  const geometry=compileConstruction(plan).geometry;
  const html=renderToStaticMarkup(<ConstructionDiagram geometry={geometry} visible={0} title="test" readOnly compact/>);
  expect(html).toContain('data-base-region');expect(html).toContain('fill-rule="evenodd"');expect(html).toContain('阴影甲：12cm²');
  expect(html.indexOf('data-base-region')).toBeLessThan(html.indexOf('data-base-segment'));
  expect(sameBaseDrawing(ConstructionSchema.parse(source),plan)).toBe(false);
  expect(parseSolutionSnapshot({analysis:'合成',basePlan:plan,includeBase:true})?.basePlan).toEqual(plan);
 });
 it('rejects unclosed paths, unknown points, unequal arc radii and free-form SVG',()=>{
  const valid=ConstructionSchema.safeParse({...source,regions:[region]});expect(valid.success).toBe(true);
  for(const edges of [[{kind:'segment',to:'A'}],[{kind:'segment',to:'Z'},{kind:'segment',to:'O'}],[{kind:'segment',to:'A'},{kind:'arc',center:'B',to:'O',direction:'ccw'}]]){
   expect(()=>compileConstruction({...source,regions:[{contours:[{start:'O',edges}]}]} as never)).toThrow();
  }
  expect(ConstructionSchema.safeParse({...source,regions:[{path:'<svg onload=evil()>'}]}).success).toBe(false);
 });
 it('keeps new fields optional for stored plans and instructs the model to retain source details',()=>{
  expect(()=>compileConstruction(source as never)).not.toThrow();
  expect(BASE_CONSTRUCTION_PROMPT).toContain('regions');expect(BASE_CONSTRUCTION_PROMPT).not.toContain('不要求精确涂色');
 });
 it('preserves a circular hole and freezes both shading and free text through auxiliary construction',()=>{
  const plan=ConstructionSchema.parse({...source,points:[...source.points,{id:'C',x:2,y:0}],regions:[{contours:[{start:'A',edges:[{kind:'arc',center:'O',to:'A',direction:'ccw'}]},{start:'C',edges:[{kind:'arc',center:'O',to:'C',direction:'cw'}]}]}],annotations:[{kind:'text',x:1,y:1,text:'<script>literal</script>'}]});
  const steps={steps:[{description:'合成中点',operation:{kind:'midpoint',id:'M',a:'A',b:'B'}}]};
  const next=parseConstructionSteps(JSON.stringify(steps),plan);
  expect(next.regions).toEqual(plan.regions);expect(next.annotations).toEqual(plan.annotations);
  expect(()=>parseConstructionSteps(JSON.stringify({...steps,regions:[]}),plan)).toThrow();
  const region=compileConstruction(next).geometry.regions[0],d=diagramRegionPath(region,p=>p,1);
  expect(d.match(/ A /g)).toHaveLength(4);expect(d.match(/ Z/g)).toHaveLength(2);
  const html=renderToStaticMarkup(<ConstructionDiagram geometry={compileConstruction(plan).geometry} visible={0} title="hole" readOnly/>);
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
 });
});
it('carries the pending-correction warning across snapshots and includes the public site watermark',()=>{
 const snapshot=parseSolutionSnapshot({analysis:'合成',basePlan:source,baseNeedsReview:true,includeBase:true})!;
 const html=renderToStaticMarkup(<SolutionDocument snapshot={snapshot}/>);
 expect(html).toContain('尚未按新纠正说明更新');expect(html).toContain('solvnote.n29.net');
 expect(html).not.toContain('localhost');
});
it.each(['primary_5','五年级上','Grade 5, 1st Semester'])('uses grade and lower knowledge before the nearest necessary extension: %s',grade=>{
 const policy=generateGradeInstruction(grade);
 expect(policy).toContain('当前年级及以下');expect(policy).toContain('最接近');expect(policy).not.toContain('年级仅是讲解方式的偏好');
 for(const review of [false,true])expect(solvePrompt(grade,review)).toContain(policy.trim());
});
it('follows the actual source width even without formula-fit mode',()=>{
 const el=document.createElement('article');vi.spyOn(el,'getBoundingClientRect').mockReturnValue({width:354} as DOMRect);
 expect(solutionImageWidth(el)).toBe(354);
});
it('exports a moderately long document in one device-density image',async()=>{
 vi.stubGlobal('devicePixelRatio',3);
 const fonts=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 try{
  const el=document.createElement('article');el.innerHTML='<h1>合成</h1>'+Array.from({length:7},(_,i)=>`<p>步骤${i}</p>`).join('');document.body.append(el);
  vi.spyOn(el,'getBoundingClientRect').mockReturnValue({width:354} as DOMRect);
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.children.length*360});
  const before=el.outerHTML,result=await renderSolutionImages(el);
  expect(result).toHaveLength(1);expect(toBlob).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({width:354,pixelRatio:3}));
  expect(el.outerHTML).toBe(before);expect(document.body.children).toHaveLength(1);
 }finally{if(fonts)Object.defineProperty(document,'fonts',fonts);else Reflect.deleteProperty(document,'fonts')}
});
it('splits only beyond the raster budget and repeats the watermark without losing any step',async()=>{
 vi.stubGlobal('devicePixelRatio',3);
 const fonts=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 const captured:{text:string;pixels:number}[]=[];
 vi.mocked(toBlob).mockImplementation(async(node,options)=>{captured.push({text:node.textContent||'',pixels:options!.width!*options!.height!*options!.pixelRatio!**2});return new Blob(['synthetic']);});
 try{
  const el=document.createElement('article');el.innerHTML=Array.from({length:24},(_,i)=>`<p>UniqueStep${i}End</p>`).join('')+'<footer data-solution-watermark>solvnote.n29.net</footer>';document.body.append(el);
  vi.spyOn(el,'getBoundingClientRect').mockReturnValue({width:354} as DOMRect);
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(function(this:HTMLElement){return this.children.length*500});
  const result=await renderSolutionImages(el);expect(result.length).toBeGreaterThan(1);
  for(const item of captured){expect(item.text).toContain('solvnote.n29.net');expect(item.pixels).toBeLessThanOrEqual(16*1024*1024);}
  for(let i=0;i<24;i++)expect(captured.filter(c=>c.text.includes(`UniqueStep${i}End`))).toHaveLength(1);
  expect(document.body.children).toHaveLength(1);
 }finally{if(fonts)Object.defineProperty(document,'fonts',fonts);else Reflect.deleteProperty(document,'fonts')}
});
it('expands an intrinsically wide table whose overflow belongs to its scroll wrapper',async()=>{
 const fonts=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 try{
  const el=document.createElement('article');el.style.padding='16px';el.innerHTML='<div><table><tbody><tr><td>rightmost cell</td></tr></tbody></table></div>';document.body.append(el);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {left:this.tagName==='TABLE'?16:0,width:this.tagName==='TABLE'?746:354} as DOMRect;});
  vi.spyOn(HTMLElement.prototype,'scrollWidth','get').mockImplementation(function(this:HTMLElement){return this.tagName==='TABLE'?746:354;});
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this.tagName==='TABLE'?746:354;});
  const images=await renderSolutionImages(el);expect(images).toHaveLength(1);
  expect(toBlob).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({width:778}));
 }finally{if(fonts)Object.defineProperty(document,'fonts',fonts);else Reflect.deleteProperty(document,'fonts')}
});
it('falls back to smaller local pages when a device cannot allocate a safe-budget canvas',async()=>{
 const fonts=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{ready:Promise.resolve()}});
 const captured:string[]=[];
 vi.mocked(toBlob).mockResolvedValueOnce(null).mockImplementation(async node=>{captured.push(node.textContent||'');return new Blob(['synthetic']);});
 try{
  const el=document.createElement('article');el.innerHTML='<p>first</p><p>second</p><p>third</p><p>fourth</p><footer data-solution-watermark>solvnote.n29.net</footer>';document.body.append(el);
  const images=await renderSolutionImages(el);expect(images).toHaveLength(2);
  expect(captured).toEqual(['firstsecondsolvnote.n29.net','thirdfourthsolvnote.n29.net']);
  expect(document.body.children).toHaveLength(1);
 }finally{if(fonts)Object.defineProperty(document,'fonts',fonts);else Reflect.deleteProperty(document,'fonts')}
});
