import type {SolutionSnapshot} from '@/lib/solution-snapshot';
import type {ConstructionPlan} from '@/lib/ai-drawing/construction';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {SolutionDocument} from '@/components/solution-document';
import {SolutionShare} from '@/components/solution-share';
import {solutionPlainText} from '@/lib/solution-share';
const base:ConstructionPlan={title:'合成底图',points:[{id:'A',x:0,y:0},{id:'B',x:4,y:0}],segments:[['A','B']],steps:[]};
const auxiliary:ConstructionPlan={...base,steps:[{description:'连接',operation:{kind:'segment',a:'A',b:'B'}}]};
const originalImage='data:image/png;base64,aGVsbG8=';
const snapshot:SolutionSnapshot={analysis:'合成题解',questionText:'合成题干',answerText:'合成答案',originalImage,basePlan:base,auxiliaryPlan:auxiliary,includeQuestion:true,includeAnswer:true,includeOriginal:true,includeBase:true,includeAuxiliary:true};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('renders independent image slots in the requested order without drawing controls',async()=>{
 await act(async()=>root.render(<SolutionDocument snapshot={snapshot}/>));
 expect([...host.querySelectorAll('h2')].map(e=>e.textContent)).toEqual(['题目','原图','原题重绘','参考答案','辅助线图','解题过程']);
 expect(host.querySelectorAll('svg')).toHaveLength(2);expect(host.querySelectorAll('img')).toHaveLength(1);expect(host.querySelector('button')).toBeNull();
 const text=solutionPlainText(host);expect(text).toContain('[图片：原图]');expect(text).toContain('[图片：原题重绘]');expect(text).not.toContain('base64');
});
it('offers three independent unchecked attachment options only when available',async()=>{
 await act(async()=>root.render(<SolutionShare {...snapshot}/>));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='分享解题过程')!.click());
 const dialog=host.querySelector('dialog')!;expect(dialog.querySelectorAll('input[type=checkbox]')).toHaveLength(5);expect(dialog.querySelector('input:checked')).toBeNull();
 await act(async()=>{const checkbox=[...dialog.querySelectorAll('label')].find(e=>e.textContent?.includes('原题重绘'))!.querySelector('input')!;checkbox.click()});
 expect([...dialog.querySelectorAll('h2')].map(e=>e.textContent)).toContain('原题重绘');expect(dialog.querySelector('[data-solution-document]')?.textContent).not.toContain('合成题干');
});
it('rejects remote images, malformed plans and unrelated fields at the reader boundary',async()=>{
 const {parseSolutionSnapshot}=await import('@/lib/solution-snapshot');
 const result=parseSolutionSnapshot({...snapshot,originalImage:'https://example.com/tracker',basePlan:{...base,svg:'<script/>'},wrongAnswerText:'private',apiKey:'private'});
 expect(result?.originalImage).toBeUndefined();expect(result?.basePlan).toBeUndefined();expect(result).not.toHaveProperty('wrongAnswerText');expect(result).not.toHaveProperty('apiKey');
 expect(parseSolutionSnapshot({analysis:42})).toBeNull();
});
it('keeps an open share snapshot frozen when the parent changes',async()=>{
 await act(async()=>root.render(<SolutionShare {...snapshot}/>));await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='分享解题过程')!.click());
 await act(async()=>root.render(<SolutionShare analysis="另一题"/>));
 const dialog=host.querySelector('dialog')!;expect(dialog.querySelectorAll('input[type=checkbox]')).toHaveLength(5);expect(dialog.textContent).toContain('合成题解');expect(dialog.textContent).not.toContain('另一题');
});
it('does not load remote image URLs during PNG rendering',async()=>{
 const {waitForSolutionImages}=await import('@/lib/solution-images');const img=document.createElement('img');img.src='https://example.com/tracker';host.append(img);
 await expect(waitForSolutionImages(host)).rejects.toThrow('图片');
});

it('rejects stale auxiliary results but retains the current base when only the answer changes',async()=>{
 const {currentDrawingAttachments}=await import('@/lib/solution-snapshot');
 const state={questionText:'q',answerText:'a',analysis:'s',image:originalImage,basePlan:base,auxiliaryPlan:auxiliary};
 expect(currentDrawingAttachments(state,'q','a','s',originalImage)).toEqual({basePlan:base,auxiliaryPlan:auxiliary});
 expect(currentDrawingAttachments(state,'other','a','s',originalImage)).toEqual({});
 expect(currentDrawingAttachments(state,'q','a','s','other')).toEqual({});
 expect(currentDrawingAttachments(state,'q','changed','s',originalImage).auxiliaryPlan).toBeUndefined();
 expect(currentDrawingAttachments(state,'q','changed','s',originalImage).basePlan).toEqual(base);
 expect(currentDrawingAttachments(state,'q','','s',originalImage)).toEqual({});
});
it('omits missing attachment options and allows second-stage picture without answer text',async()=>{
 await act(async()=>root.render(<SolutionShare analysis="题解" originalImage="https://example.com/track"/>));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='分享解题过程')!.click());
 expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
 await act(async()=>root.render(<SolutionDocument snapshot={{...snapshot,includeQuestion:false,includeOriginal:false,includeBase:false,includeAnswer:false}}/>));
 expect([...host.querySelectorAll('h2')].map(e=>e.textContent)).toEqual(['辅助线图','解题过程']);
});
it('fails explicitly for an undecodable original instead of exporting a missing picture',async()=>{
 const {waitForSolutionImages}=await import('@/lib/solution-images');const img=document.createElement('img');img.src=originalImage;Object.defineProperty(img,'complete',{value:true});Object.defineProperty(img,'naturalWidth',{value:0});host.append(img);
 await expect(waitForSolutionImages(host)).rejects.toThrow('原图无法读取');
});
it('waits for raster load and decode before continuing',async()=>{
 const {waitForSolutionImages}=await import('@/lib/solution-images');const img=document.createElement('img');img.src=originalImage;Object.defineProperty(img,'complete',{value:false});Object.defineProperty(img,'naturalWidth',{value:30});const decode=vi.fn().mockResolvedValue(undefined);img.decode=decode;host.append(img);
 let finished=false;const pending=waitForSolutionImages(host).then(()=>{finished=true});await Promise.resolve();expect(finished).toBe(false);img.dispatchEvent(new Event('load'));await pending;expect(decode).toHaveBeenCalledTimes(1);
});
it('reader receives a bounded snapshot, acknowledges once, and cleans its channel',async()=>{
 vi.useFakeTimers();
 try{
  const {receiveSolutionReader}=await import('@/lib/solution-reader');
  let listener:((event:{data:unknown})=>void)|null=null;const post=vi.fn(),close=vi.fn();
  vi.stubGlobal('BroadcastChannel',class{set onmessage(value:typeof listener){listener=value}postMessage=post;close=close});
  const receive=vi.fn(),expired=vi.fn();const cleanup=receiveSolutionReader('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',receive,expired);
  expect(post).toHaveBeenCalledWith({type:'ready'});
  listener!({data:{type:'snapshot',snapshot:{analysis:42}}});expect(receive).not.toHaveBeenCalled();
  listener!({data:{type:'snapshot',snapshot}});expect(receive).toHaveBeenCalledTimes(1);expect(post).toHaveBeenCalledWith({type:'received'});expect(close).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(65000);expect(expired).not.toHaveBeenCalled();cleanup();
 }finally{vi.useRealTimers()}
});
it('reader expires without persisting data and rejects unknown channel identifiers',async()=>{
 vi.useFakeTimers();try{
  const {receiveSolutionReader}=await import('@/lib/solution-reader');const close=vi.fn(),expired=vi.fn();
  vi.stubGlobal('BroadcastChannel',class{onmessage=null;postMessage=vi.fn();close=close});
  receiveSolutionReader('bad',vi.fn(),expired);expect(expired).toHaveBeenCalledTimes(1);
  receiveSolutionReader('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',vi.fn(),expired);vi.advanceTimersByTime(60001);expect(close).toHaveBeenCalledTimes(1);expect(expired).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers()}
});
