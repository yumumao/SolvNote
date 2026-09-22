import { getAppConfig } from "../config";
import {
    generateAnalyzePrompt,
    generateSimilarQuestionPrompt,
    generateReanswerPrompt,
    generateGeogebraPrompt,
} from "./prompts";
import type {
    AIService,
    DifficultyLevel,
    GeogebraAnalysisResult,
} from "./types";
import { callChain } from "./chain";
import { parseQuestion, parseAnswer } from "./parse";
import { AIError } from "./transport";
import { getMathTagsFromDB, getTagsFromDB } from "./tag-service";
export function dataImage(image?: string, mime = "image/jpeg") {
    if (!image) return undefined;
    return image.startsWith("data:") ? image : `data:${mime};base64,${image}`;
}
export class ManagedAIService implements AIService {
    async analyzeInput(
        text: string,
        image?: string,
        language: "zh" | "en" = "zh",
        grade?: 7 | 8 | 9 | 10 | 11 | 12 | null,
        subject?: string | null,
        gradeSemester?: string | null,
    ) {
        const [
            prefetchedMathTags,
            prefetchedPhysicsTags,
            prefetchedChemistryTags,
            prefetchedBiologyTags,
            prefetchedEnglishTags,
        ] = await Promise.all([
            getMathTagsFromDB(grade || null),
            getTagsFromDB("physics"),
            getTagsFromDB("chemistry"),
            getTagsFromDB("biology"),
            getTagsFromDB("english"),
        ]);
        const prompt = generateAnalyzePrompt(
            language,
            grade,
            subject,
            {
                customTemplate: getAppConfig().prompts?.analyze,
                prefetchedMathTags,
                prefetchedPhysicsTags,
                prefetchedChemistryTags,
                prefetchedBiologyTags,
                prefetchedEnglishTags,
            },
            gradeSemester,
        );
        return callChain(prompt, text, dataImage(image), parseQuestion);
    }
    analyzeImage(
        image: string,
        mime = "image/jpeg",
        language: "zh" | "en" = "zh",
        grade?: 7 | 8 | 9 | 10 | 11 | 12 | null,
        subject?: string | null,
        gradeSemester?: string | null,
    ) {
        return this.analyzeInput(
            "",
            dataImage(image, mime),
            language,
            grade,
            subject,
            gradeSemester,
        );
    }
    generateSimilarQuestion(
        question: string,
        tags: string[],
        language: "zh" | "en" = "zh",
        difficulty: DifficultyLevel = "medium",
        grade?: string | null,
    ) {
        return callChain(
            generateSimilarQuestionPrompt(
                language,
                question,
                tags,
                difficulty,
                { customTemplate: getAppConfig().prompts?.similar },
                grade,
            ),
            "生成一道变式题。",
            undefined,
            parseQuestion,
        );
    }
    reanswerQuestion(
        question: string,
        language: "zh" | "en" = "zh",
        subject?: string | null,
        image?: string,
        grade?: string | null,
    ) {
        return callChain(
            generateReanswerPrompt(
                language,
                question,
                subject,
                undefined,
                grade,
            ),
            question,
            dataImage(image),
            parseAnswer,
        );
    }
    analyzeForGeogebra(
        question: string,
        answer: string,
        analysis: string,
        errors?: string,
        image?: string,
    ): Promise<GeogebraAnalysisResult> {
        return callChain(
            generateGeogebraPrompt(question, answer, analysis, errors),
            "生成演示命令。",
            image,
            (s) => {
                try {
                    const v = JSON.parse(
                        s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1),
                    );
                    if (
                        typeof v.suitable !== "boolean" ||
                        !Array.isArray(v.commands) ||
                        v.commands.some((c: unknown) => typeof c !== "string")
                    )
                        throw Error();
                    return {
                        suitable: v.suitable,
                        commands: v.commands,
                        description:
                            typeof v.description === "string"
                                ? v.description
                                : "",
                    };
                } catch {
                    throw new AIError("AI_RESPONSE_ERROR", true);
                }
            },
        );
    }
}
