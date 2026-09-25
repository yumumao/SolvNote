import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownField } from "@/components/markdown-field";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("preview-first Markdown fields (real Markdown and KaTeX)", () => {
    it("renders headings, ordered steps, tables and block formulas with source collapsed", async () => {
        const content = String.raw`### 分步解答

1. 代入公式。
2. 检验结果。

| 边长 | 数值 |
| --- | --- |
| $a$ | $\sqrt{2}$ |

$$
\begin{aligned}
x &= \frac{1}{2} \\
y &= \sqrt{2}
\end{aligned}
$$`;
        await act(async () => root.render(<MarkdownField label="解析" value={content}/>));
        expect(host.querySelector("h3")?.textContent).toBe("分步解答");
        expect(host.querySelectorAll("ol li")).toHaveLength(2);
        expect(host.querySelectorAll("table td")).toHaveLength(2);
        expect(host.querySelector(".katex-display")).not.toBeNull();
        expect(host.querySelector(".katex-error")).toBeNull();
        const source = host.querySelector("details")!;
        expect(source.open).toBe(false);
        expect(source.querySelector("pre")?.textContent).toBe(content);
        source.open = true;
        expect(source.querySelector("pre")?.textContent).toBe(content);
    });
    it("updates the same canonical source and real preview on edit without network requests", async () => {
        const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
        function Editable() { const [value, setValue] = useState("$x=1$"); return <MarkdownField label="参考答案" value={value} onChange={setValue}/>; }
        await act(async () => root.render(<Editable/>));
        const source = host.querySelector("details")!; source.open = true;
        const textarea = host.querySelector("textarea")!;
        const value = String.raw`$x=\frac{3}{4}$`;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(textarea.value).toBe(value);
        expect(host.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(String.raw`x=\frac{3}{4}`);
        expect(source.open).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("keeps untrusted HTML and javascript links inert in preview and source", async () => {
        const value = '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[危险链接](javascript:alert(3))';
        await act(async () => root.render(<MarkdownField label="题目" value={value}/>));
        expect(host.querySelector("script")).toBeNull();
        expect(host.querySelector("[onerror]")).toBeNull();
        expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
        expect(host.querySelector("details pre")?.textContent).toBe(value);
    });
});

it("keeps inline code inline and uses outside markers for multi-paragraph teaching steps", async () => {
    await act(async () => root.render(<MarkdownField label="讲解" value={'使用`x`表示未知数。\n\n1. 第一步。\n\n2. 第二步。\n\n```text\nx=1\n```'}/>));
    const preview = host.querySelector(".markdown-content")!;
    const inline = preview.querySelector("p code")!;
    expect(inline.classList.contains("block")).toBe(false);
    expect(preview.querySelector("pre")?.classList.contains("overflow-x-auto")).toBe(true);
    expect(preview.querySelector("ol")?.classList.contains("list-outside")).toBe(true);
});
