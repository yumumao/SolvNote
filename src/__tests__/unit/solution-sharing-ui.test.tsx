import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { MarkdownField } from "@/components/markdown-field";
import { ConstructionDiagram } from "@/components/construction-diagram";
import { compileConstruction } from "@/lib/ai-drawing/construction";
let host: HTMLDivElement, root: Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()});
it("offers local reader and share only on opted-in solution fields",async()=>{
 const extra={shareContext:{questionText:"合成题目",answerText:"4"}};
 await act(async()=>root.render(<MarkdownField label="解题思路与步骤" value="1. 代入。" {...extra}/>));
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.includes('新标签阅读'))).toBe(true);
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='分享解题过程')).toBe(true);
 await act(async()=>root.render(<MarkdownField label="题目" value="内容"/>));
 expect(host.querySelector('[data-solution-actions]')).toBeNull();
});
it("opens a private preview without question and with reference answer selected and keeps source collapsed",async()=>{
 const extra={shareContext:{questionText:"合成题干",answerText:"合成答案"}};
 await act(async()=>root.render(<MarkdownField label="解析" value={'### 第一步\n\n$x=4$'} {...extra}/>));
 const share=[...host.querySelectorAll('button')].find(b=>b.textContent==='分享解题过程');
 expect(share).toBeDefined();
 await act(async()=>share!.click());
 const preview=host.querySelector('[data-solution-document]');
 expect(preview?.textContent).toContain('第一步');
 expect(preview?.textContent).not.toContain('合成题干');
 expect(preview?.textContent).toContain('合成答案');
 expect(host.querySelector('details')?.open).toBe(false);
});
it("left-aligns the SVG viewport without changing its fixed geometry",async()=>{
 const geometry=compileConstruction({title:"合成",points:[{id:"A",x:0,y:0},{id:"B",x:4,y:0}],segments:[["A","B"]],steps:[]});
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry.geometry} visible={0} title="合成"/>));
 const svg=host.querySelector('svg')!;
 expect(svg.getAttribute('preserveAspectRatio')).toBe('xMinYMin meet');
 expect(svg.style.marginRight).toBe('auto');
 const [x,y,w,h]=svg.getAttribute('viewBox')!.split(' ').map(Number);
 expect(w).toBeLessThan(800);expect(h).toBeLessThan(100);
 expect(host.querySelector('line')!.getAttribute('x1')).toBe('40');
 expect(host.querySelector('line')!.getAttribute('x2')).toBe('760');
 expect(x).toBeLessThan(36);expect(y).toBeLessThan(220);
});


// Share-only presentation must not change the locked construction geometry.
it("crops attachments without changing the locked ordinary geometry",async()=>{
 const geometry=compileConstruction({title:"横线",points:[{id:"A",x:0,y:0},{id:"B123",x:4,y:0}],segments:[["A","B123"]],steps:[]}).geometry;
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="合成"/>));
 const base=host.querySelector('[data-layer="base"]')!.innerHTML;
 const ordinaryViewBox=host.querySelector('svg')!.getAttribute('viewBox');
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="合成" readOnly compact/>));
 const svg=host.querySelector('svg')!;
 const [x,y,w,h]=svg.getAttribute('viewBox')!.split(' ').map(Number);
 expect(h).toBeLessThan(100);expect(w).toBeLessThan(860);
 expect(x).toBeLessThan(36);expect(y).toBeLessThan(220);
 expect(x+w).toBeGreaterThan(840);expect(y+h).toBeGreaterThan(254);
 expect(host.querySelector('[data-layer="base"]')!.innerHTML).toBe(base);
 expect(host.textContent).not.toContain('绘制无需联网');
 expect(host.textContent).toContain('示意图');
 // compact alone must not alter the interactive viewport.
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="合成" compact/>));
 expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe(ordinaryViewBox);
});
it.each(['cw','ccw'] as const)("bounds a %s quarter arc, its labels and all outside auxiliary points",async direction=>{
 const points=[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}];
 const arc={center:'O',start:direction==='ccw'?'A':'B',end:direction==='ccw'?'B':'A',direction,sector:true};
 const plan={title:'四分之一圆',points,segments:[],arcs:[arc],steps:[]};
 const geometry=compileConstruction(plan).geometry;
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="合成" readOnly compact/>));
 const svg=host.querySelector('svg')!;const [x,y,w,h]=svg.getAttribute('viewBox')!.split(' ').map(Number);
 expect(w).toBeLessThan(290);expect(h).toBeLessThan(290);
 expect(x).toBeLessThan(396);expect(y).toBeLessThan(10);
 expect(x+w).toBeGreaterThan(636);expect(y+h).toBeGreaterThan(254);
 const expanded=compileConstruction({...plan,steps:[{description:'镜像副本',operation:{kind:'reflect',id:'C',point:'A',a:'O',b:'B'}}]}).geometry;
 await act(async()=>root.render(<ConstructionDiagram geometry={expanded} visible={1} title="合成" readOnly compact/>));
 const vb=host.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
 expect(vb[0]).toBeLessThan(186);expect(vb[0]+vb[2]).toBeGreaterThan(636);
});
it("keeps full circles and major arcs in compact attachments",async()=>{
 for(const shape of [
  {circles:[{center:'O',through:'A'}]},
  {arcs:[{center:'O',start:'A',end:'B',direction:'cw' as const,sector:false}]},
 ]){
  const geometry=compileConstruction({title:'圆与优弧',points:[{id:'O',x:0,y:0},{id:'A',x:4,y:0},{id:'B',x:0,y:4}],segments:[],steps:[],...shape}).geometry;
  await act(async()=>root.render(<ConstructionDiagram geometry={geometry} visible={0} title="合成" readOnly compact/>));
  const [x,y,w,h]=host.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
  expect(x).toBeLessThan(190);expect(y).toBeLessThan(40);
  expect(x+w).toBeGreaterThan(610);expect(y+h).toBeGreaterThan(460);
  expect(w).toBeLessThan(510);expect(h).toBeLessThan(510);
 }
});

import {SolutionShare} from '@/components/solution-share';
import {renderSolutionImages} from '@/lib/solution-images';
vi.mock('@/lib/solution-images',()=>({renderSolutionImages:vi.fn()}));
it("groups every page download before the first image and keeps previews contiguous",async()=>{
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 let id=0;URL.createObjectURL=vi.fn(()=> 'blob:synthetic-'+(++id));URL.revokeObjectURL=vi.fn();
 vi.mocked(renderSolutionImages).mockResolvedValue([1,2,3].map(i=>({blob:new Blob(['synthetic'],{type:'image/png'}),name:'page-'+i+'.png'})));
 try{
  await act(async()=>root.render(<SolutionShare analysis="合成解题过程" inline/>));
  const generate=[...host.querySelectorAll('button')].find(b=>b.textContent==='生成分享长图')!;
  await act(async()=>generate.click());
  const gallery=host.querySelector('[aria-label="分享图片"]')!;
  const toolbar=gallery.querySelector('[aria-label="长图下载"]');expect(toolbar).not.toBeNull();
  const links=[...toolbar!.querySelectorAll<HTMLAnchorElement>('a[download]')];expect(links).toHaveLength(3);
  const figures=[...gallery.querySelectorAll('figure')];expect(figures).toHaveLength(3);
  expect(!!(toolbar!.compareDocumentPosition(figures[0])&Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  for(let i=0;i<3;i++){
   expect(links[i].download).toBe('page-'+(i+1)+'.png');expect(links[i].href).toBe(figures[i].querySelector('img')!.src);
   expect(figures[i].parentElement?.hasAttribute('data-solution-image-stack')).toBe(true);
   expect(figures[i].querySelector('figcaption')).toBeNull();
  }
  await act(async()=>root.unmount());root=createRoot(host);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
 }finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});

it('invalidates exported images and releases URLs when question selection links its original',async()=>{
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 URL.createObjectURL=vi.fn(()=> 'blob:synthetic-link');URL.revokeObjectURL=vi.fn();
 vi.mocked(renderSolutionImages).mockResolvedValue([{blob:new Blob(['synthetic'],{type:'image/png'}),name:'page.png'}]);
 try{
  await act(async()=>root.render(<SolutionShare analysis="合成解题" questionText="合成题干" originalImage="data:image/png;base64,aGVsbG8=" inline/>));
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='生成分享长图')!.click());
  expect(host.querySelector('[aria-label="分享图片"]')).not.toBeNull();
  await act(async()=>[...host.querySelectorAll('label')].find(l=>l.textContent==='附带题干')!.querySelector('input')!.click());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-link');expect(host.querySelector('[aria-label="分享图片"]')).toBeNull();
  expect([...host.querySelectorAll('label')].find(l=>l.textContent==='附带原图')!.querySelector('input')!.checked).toBe(true);
 }finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});
