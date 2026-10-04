"use client";
import { useId } from "react";
import { ReadableMarkdown } from "./readable-markdown";
import type { SolutionContext } from "./solution-document";
import { Textarea } from "./ui/textarea";

/** One canonical string: preview first, source on demand. Editing never calls AI. */
export function MarkdownField({ label, value, onChange, placeholder, emptyText = "暂无内容", minHeight = "min-h-32", shareContext, readingControls = false }: {
    label: string;
    value: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    emptyText?: string;
    minHeight?: string;
    shareContext?: SolutionContext;
    readingControls?: boolean;
}) {
    const id = useId();
    return <section className="min-w-0 rounded-xl border bg-card p-4 space-y-3" aria-labelledby={id}>
        <h4 id={id} className="font-semibold text-base border-l-4 border-primary pl-3">{label}</h4>
        {value.trim() ? <ReadableMarkdown content={value} readingControls={readingControls || !!shareContext} shareContext={shareContext}/> : <p className="text-sm text-muted-foreground">{emptyText}</p>}
        <details data-markdown-source className="rounded-lg border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm text-muted-foreground focus-visible:outline focus-visible:outline-primary">
                {onChange ? "查看/编辑标记代码" : "查看标记代码"} · Markdown / LaTeX
            </summary>
            {onChange ? <Textarea aria-label={`${label}标记代码`} value={value}
                onChange={event => onChange(event.target.value)} placeholder={placeholder}
                className={`${minHeight} mt-3 font-mono text-sm`}/>
                : <pre className="mt-3 whitespace-pre-wrap break-words overflow-x-auto text-sm font-mono">{value || "（空）"}</pre>}
        </details>
    </section>;
}
