"use client";
import React, {useEffect, useRef} from 'react';
import {fitMarkdownWidth} from '@/lib/markdown-fit';
import readingStyles from './markdown-reading.module.css';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeMathMarkdown } from '@/lib/markdown-math';

interface MarkdownRendererProps {
    content: string;
    className?: string;
    localShare?: boolean;
    fitWidth?: boolean;
}

export function MarkdownRenderer({ content, className = '', localShare = false, fitWidth = false }: MarkdownRendererProps) {
    const processedContent = normalizeMathMarkdown(content);

    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = container.current;
        if (!node) return;
        let disposed = false, frame = 0, lastWidth = -1;
        const measure = () => { if (!disposed) fitMarkdownWidth(node); };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width;
            if (width !== lastWidth) { lastWidth = width; schedule(); }
        });
        observer?.observe(node);
        window.addEventListener('resize', schedule);
        void document.fonts?.ready.then(() => { if (!disposed) schedule(); });
        return () => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
    }, [content, fitWidth]);
    return (
        <div ref={container} data-markdown-fit={fitWidth} className={`markdown-content ${readingStyles.reading} ${fitWidth ? readingStyles.fit : ""} overflow-x-auto min-w-0 ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    // Sharing never fetches Markdown images or enables external links.
                    ...(localShare ? {
                        img: ({ alt }: { alt?: string }) => <span>[图片未包含{alt ? '：' + alt : ''}]（图片需通过图片分享）</span>,
                        a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
                    } : {}),
                    // 自定义样式
                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2" {...props} />,
                    h4: ({ node, ...props }) => <h4 className="text-base font-bold mt-4 mb-2" {...props} />,
                    h5: ({ node, ...props }) => <h5 className="text-base font-bold mt-3 mb-2" {...props} />,
                    h6: ({ node, ...props }) => <h6 className="text-sm font-bold mt-3 mb-2" {...props} />,
                    p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-outside pl-6 mb-3 space-y-1" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal list-outside pl-6 mb-3 space-y-1" {...props} />,
                    li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground" {...props} />
                    ),
                    // react-markdown v10 has no `inline` prop; style the enclosing pre separately.
                    pre: ({ node, ...props }) => (
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto my-3 [&_code]:bg-transparent [&_code]:p-0" {...props} />
                    ),
                    code: ({ node, className, ...props }) => (
                        <code className={`bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground ${className || ""}`} {...props} />
                    ),
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border" {...props} />
                        </div>
                    ),
                    th: ({ node, ...props }) => (
                        <th className="border border-border px-4 py-2 bg-muted font-semibold text-left" {...props} />
                    ),
                    td: ({ node, ...props }) => (
                        <td className="border border-border px-4 py-2" {...props} />
                    ),
                    strong: ({ node, ...props }) => <strong className="font-bold text-foreground" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
}
