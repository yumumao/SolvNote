import { validateParsedQuestion } from "./schema";
import { normalizeMistakeStatusForSave } from "../mistake-status";
import { AIError } from "./transport";
export function tag(text: string, name: string) {
    return (
        text
            .match(
                new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"),
            )?.[1]
            ?.trim() || ""
    );
}
export function parseAnswer(text: string) {
    const answerText = tag(text, "answer_text"),
        analysis = tag(text, "analysis");
    if (!answerText || !analysis) throw new AIError("AI_RESPONSE_ERROR", true);
    const wrongAnswerText = tag(text, "wrong_answer_text");
    return {
        answerText,
        analysis,
        knowledgePoints: tag(text, "knowledge_points")
            .split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 5),
        wrongAnswerText,
        mistakeAnalysis: tag(text, "mistake_analysis"),
        mistakeStatus: normalizeMistakeStatusForSave(
            tag(text, "mistake_status"),
            wrongAnswerText,
        ),
    };
}
export function parseQuestion(text: string) {
    try {
        return validateParsedQuestion({
            ...parseAnswer(text),
            questionText: tag(text, "question_text"),
            subject: tag(text, "subject") || "其他",
            requiresImage: tag(text, "requires_image").toLowerCase() === "true",
        });
    } catch {
        throw new AIError("AI_RESPONSE_ERROR", true);
    }
}
