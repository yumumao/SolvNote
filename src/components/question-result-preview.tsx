import type { ParsedQuestion } from "@/lib/ai/types";
import { ParsedQuestionSchema } from "@/lib/ai/schema";
import { MarkdownField } from "./markdown-field";

/** Old plain-text replies remain readable; never present unvalidated JSON as a question. */
export function readQuestionResult(text: string): ParsedQuestion | undefined {
    try {
        const parsed = ParsedQuestionSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : undefined;
    } catch { return undefined; }
}

export function QuestionResultPreview({ result }: { result: ParsedQuestion }) {
    const status = result.mistakeStatus === "wrong_attempt" ? "做错了"
        : result.mistakeStatus === "not_attempted" ? "未作答/不会做" : "未判断";
    return <div className="space-y-4" aria-label="错题本结构化结果">
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-primary/10 px-3 py-1">{result.subject}</span>
            {result.knowledgePoints.map((point, index) => <span key={index} className="rounded-full bg-muted px-3 py-1">{point}</span>)}
            {result.requiresImage && <span className="text-muted-foreground">本题依赖原图，请结合题图核对。</span>}
        </div>
        <MarkdownField label="题目内容" value={result.questionText}/>
        <MarkdownField readingControls label="参考答案" value={result.answerText}/>
        <MarkdownField label="解题思路与步骤" value={result.analysis} shareContext={{questionText:result.questionText,answerText:result.answerText}}/>
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900 dark:bg-amber-950/10" aria-label="错因分析">
            <h4 className="font-semibold">错因分析</h4>
            <p className="text-sm text-muted-foreground">作答状态：{status}</p>
            <MarkdownField label="错误解答原文" value={result.wrongAnswerText} emptyText="未提供可确认的错误作答"/>
            <MarkdownField label="错因与改进" value={result.mistakeAnalysis}
                emptyText={result.wrongAnswerText ? "尚无明确错因，请补充或核对作答过程。" : "未提供错误作答，不推测个人错因。可以补充你的解答后继续追问。"}/>
        </section>
    </div>;
}
