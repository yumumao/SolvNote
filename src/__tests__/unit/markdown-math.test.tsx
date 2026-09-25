import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe,it,expect,vi } from "vitest";
import { MarkdownRenderer } from "@/components/markdown-renderer";
describe("notebook LaTeX rendering",()=>{
 it("preserves LaTeX commands beginning with n rather than turning them into newlines",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div");const root=createRoot(host);
  try{await act(async()=>{root.render(<MarkdownRenderer content={String.raw`$x \neq y$, $\nu$, $\nabla f$ and $\frac{1}{2}$`}/>);});
   const annotations=[...host.querySelectorAll('annotation[encoding="application/x-tex"]')].map(a=>a.textContent);
   expect(annotations).toEqual([String.raw`x \neq y`,String.raw`\nu`,String.raw`\nabla f`,String.raw`\frac{1}{2}`]);expect(host.querySelector(".katex-error")).toBeNull();
  }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
 });
});
