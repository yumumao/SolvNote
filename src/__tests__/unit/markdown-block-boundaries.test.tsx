import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {MarkdownRenderer} from "@/components/markdown-renderer";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
const draw=async(content:string)=>{await act(async()=>root.render(<MarkdownRenderer content={content}/>));};
const formulas=()=>[...host.querySelectorAll('annotation[encoding="application/x-tex"]')].map(a=>a.textContent);
describe("math block boundaries do not consume following Markdown",()=>{
 it.each([
  String.raw`$$\begin{aligned}
S&=9\pi-4\pi\\
 &=\boxed{5\pi}.
\end{aligned}$$
### 检验与总结
当$r=2$时，**核对相切条件**。`,
  String.raw`$$
\begin{aligned}
S&=9\pi-4\pi\\
 &=\boxed{5\pi}.
\end{aligned}$$ ### 检验与总结
当$r=2$时，**核对相切条件**。`,
  String.raw`\[\begin{aligned}
S&=9\pi-4\pi\\
 &=\boxed{5\pi}.
\end{aligned}\]
### 检验与总结
当\(r=2\)时，**核对相切条件**。`,
 ])("renders aligned formula and the following heading independently",async(content)=>{
  await draw(content);expect(host.querySelector('h3')?.textContent).toBe('检验与总结');
  expect(host.querySelector('strong')?.textContent).toBe('核对相切条件');
  expect(host.querySelector('.katex-error')).toBeNull();expect(host.querySelectorAll('.katex-display')).toHaveLength(1);
  expect(formulas()).toHaveLength(2);expect(formulas()[0]).toContain(String.raw`\begin{aligned}`);expect(formulas()[0]).not.toContain('###');expect(formulas()[1]).toBe('r=2');
 });
 it("keeps punctuation/newlines inside math rather than injecting paragraph breaks",async()=>{
  const math=String.raw`\begin{aligned}
x&=1.\\
\text{说明。}
\\ y&=2
\end{aligned}`;
  await draw('$$\n'+math+'\n$$\n\n正文。');expect(formulas()).toEqual([math]);expect(host.querySelector('.katex-error')).toBeNull();
 });
 it("preserves code, escaped currency, tables, and ordinary inline math",async()=>{
  const code=String.raw`$$\begin{aligned}x&=1\end{aligned}$$`;
  await draw('```tex\n'+code+'\n```\n\n`'+code+'`\n\n价格\\$20；$x \\neq y$\n\n|项目|值|\n|---|---|\n|A|$x$|');
  expect([...host.querySelectorAll('code')].map(e=>e.textContent)).toEqual([code+'\n',code]);expect(host.querySelector('table')).not.toBeNull();expect(formulas()).toEqual([String.raw`x \neq y`,'x']);expect(host.textContent).toContain('价格$20');
 });
});
