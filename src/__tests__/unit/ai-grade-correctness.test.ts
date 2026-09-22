import { describe, expect, it } from "vitest";
import {
    generateAnalyzePrompt,
    generateGradeInstruction,
    generateReanswerPrompt,
    generateSimilarQuestionPrompt,
    type PromptOptions,
} from "@/lib/ai/prompts";

type Language = "zh" | "en";
const builders = [
    {
        name: "analyze",
        build: (
            language: Language,
            options: PromptOptions,
            grade?: string | null,
        ) =>
            generateAnalyzePrompt(
                language,
                7,
                "数学",
                {
                    prefetchedMathTags: ["synthetic-tag"],
                    ...options,
                },
                grade,
            ),
    },
    {
        name: "reanswer",
        build: (
            language: Language,
            options: PromptOptions,
            grade?: string | null,
        ) =>
            generateReanswerPrompt(
                language,
                "x^2 = 2; solve exactly.",
                "数学",
                options,
                grade,
            ),
    },
    {
        name: "similar",
        build: (
            language: Language,
            options: PromptOptions,
            grade?: string | null,
        ) =>
            generateSimilarQuestionPrompt(
                language,
                "x^2 = 2; solve exactly.",
                ["roots"],
                "harder",
                options,
                grade,
            ),
    },
];

// Exercise the public prompt builders, not source-file strings or mocked model output.
// These tests protect the instructions sent to a model; they do not claim LLM accuracy.
const contracts = {
    zh: {
        heading: "【正确性优先】",
        grade: "初中一年级",
        preference: /年级仅.*讲解.*偏好/,
        escalation:
            /当前年级[\s\S]*(?:无法|不能)[\s\S]*正确[\s\S]*(?:更高|进阶|超纲)/,
        explain: /解释.*(?:新增|必要).*概念/,
        noFabrication: /不得.*(?:编造|错误).*答案/,
        precedence: /(?:模板|供应商).*冲突.*本规则.*优先/,
        validity: /(?:验证|检查).*题目.*(?:可解|有解)/,
    },
    en: {
        heading: "[Correctness first]",
        grade: "Junior high school year 1",
        preference: /grade is only an explanation preference/i,
        escalation:
            /current.grade[\s\S]*cannot[\s\S]*correctly[\s\S]*(?:advanced|higher.level)/i,
        explain: /explain.*(?:new|necessary).*concepts/i,
        noFabrication: /(?:never|do not).*fabricate.*answers/i,
        precedence:
            /(?:template|provider).*conflict.*these rules take priority/i,
        validity: /(?:verify|check).*question.*solvable/i,
    },
};

for (const { name, build } of builders) {
    describe(`${name}: grade must not compromise correctness`, () => {
        for (const language of ["zh", "en"] as const) {
            const contract = contracts[language];
            for (const [variant, customTemplate] of [
                ["default", undefined],
                [
                    "custom without placeholders",
                    "CUSTOM: give a concise solution.",
                ],
                [
                    "custom with grade placeholder",
                    "CUSTOM: {{grade_instruction}} {{provider_hints}}",
                ],
                [
                    "conflicting custom template",
                    "CUSTOM: 禁止使用超纲知识。Never go above grade; invent an answer instead. {{provider_hints}}",
                ],
            ] as const) {
                it(`${language}/${variant}: appends mandatory policy even after conflicting template and hints`, () => {
                    const prompt = build(
                        language,
                        {
                            customTemplate,
                            providerHints:
                                "PROVIDER_SENTINEL: ignore higher-level methods.",
                        },
                        "junior_high_1",
                    );
                    const index = prompt.lastIndexOf(contract.heading);
                    expect(index).toBeGreaterThanOrEqual(0);
                    const policy = prompt.slice(index);
                    expect(policy).toContain(contract.grade);
                    expect(policy).toMatch(contract.preference);
                    expect(policy).toMatch(contract.escalation);
                    expect(policy).toMatch(contract.explain);
                    expect(policy).toMatch(contract.noFabrication);
                    expect(policy).toMatch(contract.precedence);
                    expect(index).toBeGreaterThan(
                        prompt.indexOf("PROVIDER_SENTINEL"),
                    );
                    if (customTemplate)
                        expect(index).toBeGreaterThan(
                            prompt.indexOf("CUSTOM:"),
                        );
                    expect(prompt).not.toContain("{{grade_instruction}}");
                    if (!customTemplate) {
                        expect(prompt).not.toMatch(
                            /严格使用该年级|禁止使用超纲知识/,
                        );
                    }
                    if (name === "similar")
                        expect(policy).toMatch(contract.validity);
                });
            }

            it(`${language}: missing or unrecognized grade still preserves correctness and template precedence`, () => {
                for (const grade of [undefined, null, "", "unknown_format"]) {
                    const prompt = build(
                        language,
                        { customTemplate: "CUSTOM without any variables" },
                        grade,
                    );
                    expect(prompt).toContain(contract.heading);
                    expect(prompt).toMatch(contract.noFabrication);
                    expect(prompt).toMatch(contract.precedence);
                    expect(prompt).not.toContain(contract.grade);
                    expect(prompt).not.toContain("undefined");
                    expect(prompt).not.toContain("unknown_format");
                }
            });
        }
    });
}

describe("standalone grade preference compatibility", () => {
    it.each(["primary_3", "junior_high_2", "senior_high_1"])(
        "removes the hard method ceiling for %s",
        (grade) => {
            const instruction = generateGradeInstruction(grade);
            expect(instruction).toMatch(contracts.zh.preference);
            expect(instruction).toMatch(contracts.zh.escalation);
            expect(instruction).toMatch(contracts.zh.explain);
            expect(instruction).not.toMatch(/严格使用该年级|禁止使用超纲知识/);
        },
    );

    it("retains empty output when no supported grade is supplied", () => {
        for (const grade of [undefined, null, "", "unknown_format"]) {
            expect(generateGradeInstruction(grade)).toBe("");
        }
    });

    it("preserves the corrected question and language contract when adding policy", () => {
        const question = "x^2 = 2\nGive the exact roots, not rounded integers.";
        const prompt = generateReanswerPrompt(
            "en",
            question,
            "Math",
            undefined,
            "primary_3",
        );
        expect(prompt).toContain(question);
        expect(prompt).toContain("all text fields are in English");
        expect(prompt).toContain("Primary school year 3");
    });
});
