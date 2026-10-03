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
it("opens a private preview with only solution selected and keeps source collapsed",async()=>{
 const extra={shareContext:{questionText:"合成题干",answerText:"合成答案"}};
 await act(async()=>root.render(<MarkdownField label="解析" value={'### 第一步\n\n$x=4$'} {...extra}/>));
 const share=[...host.querySelectorAll('button')].find(b=>b.textContent==='分享解题过程');
 expect(share).toBeDefined();
 await act(async()=>share!.click());
 const preview=host.querySelector('[data-solution-document]');
 expect(preview?.textContent).toContain('第一步');
 expect(preview?.textContent).not.toContain('合成题干');
 expect(preview?.textContent).not.toContain('合成答案');
 expect(host.querySelector('details')?.open).toBe(false);
});
it("left-aligns the SVG viewport without changing its fixed geometry",async()=>{
 const geometry=compileConstruction({title:"合成",points:[{id:"A",x:0,y:0},{id:"B",x:4,y:0}],segments:[["A","B"]],steps:[]});
 await act(async()=>root.render(<ConstructionDiagram geometry={geometry.geometry} visible={0} title="合成"/>));
 const svg=host.querySelector('svg')!;
 expect(svg.getAttribute('preserveAspectRatio')).toBe('xMinYMin meet');
 expect(svg.style.maxWidth).toBe('800px');
 expect(svg.getAttribute('viewBox')).toBe('0 0 800 500');
});
