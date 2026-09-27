// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {MarkdownRenderer} from "@/components/markdown-renderer";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it("renders section and nested step headings in bold without changing the Markdown",async()=>{
 const content=["### 分步解答","","#### 第一步：整理条件","","正文与**重要依据**。","","#### 第二步：作辅助线","","##### 对应关系","","###### 验证"].join(String.fromCharCode(10));
 await act(async()=>root.render(<MarkdownRenderer content={content}/>));
 const headings=[...host.querySelectorAll("h3,h4,h5,h6")];
 expect(headings.map(h=>h.textContent)).toEqual(["分步解答","第一步：整理条件","第二步：作辅助线","对应关系","验证"]);
 for(const h of headings)expect(h.classList.contains("font-bold")).toBe(true);
 expect(host.querySelector("strong")?.textContent).toBe("重要依据");
});
