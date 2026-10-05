import { callChain } from "../ai/chain";
import { aiRun } from "../ai-jobs/context";
import { AIError } from "../ai/transport";
import { angleLabelKey, DecisionSchema, parseGeometryCheck, parseJSON, RECOGNIZE_PROMPT, solvePrompt, parseTranscript } from "./protocol";
import type { DialoguePayload } from "./types";

import { detailCrops } from "./crops";
import { GEOMETRY_CHECK_PROMPT } from "./geometry-check";

// A review checkpoint may contain a candidate result without any completed answer.
function hasCompletedSolution(p: DialoguePayload) {
    return !!p.result && p.messages.some(m => m.kind === "answer");
}
/** Context is explicit and bounded; never silently summarize away geometry. */
export function dialogueContext(p: DialoguePayload) {
    const clarifications = [...(p.transcriptClarifications ?? []), ...(p.followUpClarifications ?? [])];
    const context = JSON.stringify({
        question: p.input.questionText, subject: p.input.subject,
        followUp: { mode: hasCompletedSolution(p) ? p.followUpMode ?? "auto" : "update", hasCurrentSolution: hasCompletedSolution(p) },
        transcription: p.followUpTranscript ?? p.transcript, questionsToCheck: p.questions,
        ...(clarifications.length ? {transcriptionAuthority:"user_clarified",transcriptionClarifications:clarifications} : p.userCorrectedTranscript ? {transcriptionAuthority:"user_corrected"} : {}),
        imageContext: { sourceImageAvailable: !!p.input.imageBase64, rereadsUsed: p.rereads, rereadLimit: 1 },
        messages: p.messages.map(m => ({ kind: m.kind, text: m.text, round: m.round })),
    });
    if (context.length > 200000) throw new AIError("AI_CONTEXT_LIMIT");
    return context;
}
export async function advanceDialogue(p: DialoguePayload, checkpoint: () => Promise<void>): Promise<{
    state: "answered" | "awaiting_user"; payload: DialoguePayload; discussion?: string;
}> {
    const followUpMode = hasCompletedSolution(p) ? p.followUpMode ?? "auto" : undefined;
    const run = aiRun.getStore();
    if (!run) throw new AIError("AI_INTERNAL_ERROR");
    const image = p.input.imageBase64
        ? p.input.imageBase64.startsWith("data:") ? p.input.imageBase64 : `data:${p.input.mimeType};base64,${p.input.imageBase64}`
        : undefined;
    const rereadImage=p.input.originalImageBase64 || image;
    const wait = async (questions: string[]) => {
        p.questions = questions;
        await checkpoint();
        return { state: "awaiting_user" as const, payload: p };
    };
    if (image && !p.transcript) {
        p.transcript = await callChain(RECOGNIZE_PROMPT, dialogueContext(p), image,
            parseTranscript, { role: "recognize", stage: "recognize" });
        await checkpoint();
    }
    let detailImages:string[]=[];
    const geometry=p.transcript?.geometry;
    const humanReviewed=p.userCorrectedTranscript || !!p.transcriptClarifications?.length || !!p.followUpClarifications?.length;
    if(image && geometry && !humanReviewed){
        const regions=[...geometry.regions,...geometry.angles.flatMap(a=>a.region?[a.region]:[])];
        detailImages=await detailCrops(rereadImage!,regions);
        if(geometry.angles.length && !p.geometryChecked){
            if(p.geometryCheckStarted || p.rereads>=1)return wait(["关键角标尚未核对完成，请补充具体角标说明或修订题设后继续，避免重复发送同一核对请求。"]);
            p.geometryCheckStarted=true;p.rereads++;
            await checkpoint();
            const current = p.transcript!;
            const checkContext = JSON.stringify({
                question: p.input.questionText,
                transcription: {
                    text: current.text,
                    facts: current.facts,
                    uncertainties: current.uncertainties,
                    missingInformation: current.missingInformation,
                    geometryHypotheses: geometry,
                },
                labelsToLocate: geometry.angles.map(a => a.label),
                humanMessages: p.messages
                    .filter(m => m.kind === "question" || m.kind === "clarification")
                    .map(m => m.text),
                imageOrder: { first: "complete_original", following: "same_original_detail_crops" },
            });
            const checked = await callChain(
                GEOMETRY_CHECK_PROMPT,
                checkContext,
                rereadImage,
                parseGeometryCheck,
                { role: "recognize", stage: "geometry_check", detailImages, question: ["核对编号角的顶点与两条射线，不沿用初次角名猜测"] },
            );
            const requestedLabels = new Set(geometry.angles.map(a => angleLabelKey(a.label)));
            const verifiedByLabel = new Map(checked.angles.map(angle => [angleLabelKey(angle.label), angle]));
            const missing = geometry.angles.filter(a => !verifiedByLabel.has(angleLabelKey(a.label)));
            const unexpected = checked.angles.filter(angle => !requestedLabels.has(angleLabelKey(angle.label)));
            const mergedAngles = geometry.angles.map(original => {
                const verified = requestedLabels.size === geometry.angles.length
                    ? verifiedByLabel.get(angleLabelKey(original.label))
                    : undefined; // Ambiguous original labels must retain their original hypotheses.
                return verified
                    ? { ...original, ...verified, label: original.label, region: verified.region ?? original.region }
                    : original;
            });
            const mergedTranscript = {
                ...current,
                geometry: { regions: geometry.regions, angles: mergedAngles },
                geometryUncertainties: checked.geometryUncertainties,
            };
            const criticalDoubts = [
                ...(requestedLabels.size !== geometry.angles.length ? ["原转录中存在重复编号角，无法与核对结果安全对应，请补充具体编号说明"] : []),
                ...checked.geometryUncertainties,
                ...unexpected.map(angle => `模型返回了未请求的编号角${angle.label}，无法与当前题图安全对应`),
            ];
            if (missing.length || criticalDoubts.length) {
                p.transcript = {
                    ...mergedTranscript,
                    uncertainties: [
                        ...current.uncertainties,
                        ...missing.map(a => `编号角${a.label}的顶点或两条射线仍未确认`),
                    ].slice(0, 8),
                };
                await checkpoint();
                return wait([
                    ...missing.map(a => `编号角${a.label}的顶点或两条射线仍未确认`),
                    ...criticalDoubts,
                ].slice(0, 8));
            }
            p.transcript = mergedTranscript;
            p.geometryChecked = true;
            await checkpoint();
        }
    }
    const solve = async (stage: "solve" | "reread" | "review", modelId?: string, review = stage === "review") => {
        const decision = await callChain(solvePrompt(p.input.gradeSemester, review, p.input.language, followUpMode),
            dialogueContext(p) + (review ? `\n候选答案：${JSON.stringify(p.result)}` : ""), stage === "reread" ? rereadImage : image,
            raw => parseJSON(raw, DecisionSchema), { role: "solve", stage, modelId, question: p.questions, ...(detailImages.length ? {detailImages} : {}) });
        if (!review) p.solverId = run.lastModel;
        await checkpoint();
        return decision;
    };
    const checkVisualDoubts = async (decision: ReturnType<typeof DecisionSchema.parse>, review = false) => {
        // A reader's missingInformation is not a user-confirmed fact. Only a solver
        // may decide that outside material or a personal choice is truly needed.
        // Legacy needs_user responses get the same bounded visual check, not a
        // keyword guess or an unbounded cycle of expensive requests.
        const needsImageCheck = decision.status === "needs_visual_check" ||
            (decision.status === "needs_user" && decision.reason !== "missing_source" && decision.reason !== "user_choice");
        if (!needsImageCheck || !image || p.rereads >= 1 || humanReviewed) return decision;
        const modelId = review ? run.lastModel : p.solverId;
        p.questions = decision.questions;
        p.rereads++;
        await checkpoint(); // Persist the limit BEFORE dispatch; a crash never resets it.
        const visual = run.config?.models.find(m => m.id === modelId)?.capabilities.includes("vision");
        if (visual) return solve("reread", modelId, review);
        // Independence applies to the review verdict, not to reading pixels. The
        // only available visual reader may also be the original solver; keep
        // its role strictly transcription, then restore the reviewer exclusion.
        const excludedModel = run.excludeModel;
        if (review) run.excludeModel = undefined;
        try {
            const reread = await callChain(RECOGNIZE_PROMPT, dialogueContext(p), rereadImage,
                parseTranscript, { role: "recognize", stage: "reread", question: p.questions });
            // Persist supplemental pixels for retry/context, but do not mutate
            // the adopted answer's diagram evidence for a detail-only discussion.
            if (!review && followUpMode && followUpMode !== "update") p.followUpTranscript = reread;
            else p.transcript = reread;
        } finally { run.excludeModel = excludedModel; }
        await checkpoint();
        // Even an inconclusive reader cannot bypass the responsible solver/reviewer.
        return solve(review ? "review" : "solve", modelId, review);
    };
    const decision = await checkVisualDoubts(await solve("solve", p.solverId));
    if (decision.status === "discussion" || (decision.status === "solved" && followUpMode === "explain")) {
        // A reply without a complete solution cannot complete an initial/update round.
        // Enforce the explicit mode outside callChain: never dispatch another model
        // just to classify the reply or fix a mode mismatch.
        if (!followUpMode || followUpMode === "update") throw new AIError("AI_RESPONSE_ERROR", false, 0, "JSON_SCHEMA_INVALID");
        const discussion = decision.status === "discussion" ? decision.text
            : `${decision.result.answerText}\n\n${decision.result.analysis}`;
        p.questions = [];
        p.followUpTranscript = undefined;
        p.followUpClarifications = undefined;
        return { state: "answered", payload: p, discussion };
    }
    if (decision.status !== "solved") return wait(decision.questions);
    if (p.followUpTranscript) {
        p.transcript = p.followUpTranscript;
        p.followUpTranscript = undefined;
    }
    if (p.followUpClarifications?.length) {
        p.transcriptClarifications = [...(p.transcriptClarifications ?? []), ...p.followUpClarifications];
        p.followUpClarifications = undefined;
    }
    const sourceBackedResult = (result: typeof decision.result) => {
        let questionText = result.questionText.trim();
        if (!questionText) {
            const transcribed = p.transcript?.text.trim();
            const initialText = p.input.questionText.trim();
            questionText = transcribed || initialText;
            if (transcribed && initialText && transcribed !== initialText) {
                questionText += "\n\n### 原始文字说明（与后续人工核对冲突时，以人工核对为准）\n" + initialText;
            }
            const facts = p.transcript?.facts.map(f => f.detail) ?? [];
            if (facts.length) questionText += "\n\n### 转录条件\n" + facts.join("\n");
            if (p.geometryChecked && p.transcript?.geometry?.angles.length) {
                questionText += "\n\n### 已核对编号角\n" + p.transcript.geometry.angles
                    .map(a => a.label + "：顶点" + a.vertex + "，两条射线经过点" + a.arms.join("、")).join("\n");
            }
            if (p.transcriptClarifications?.length) questionText += "\n\n### 人工补充（按时间顺序，较新说明优先）\n" + p.transcriptClarifications.join("\n");
        }
        return { ...result, questionText, requiresImage: Boolean(image) || result.requiresImage };
    };
    p.result = sourceBackedResult(decision.result);
    // Once auto chooses a replacement, interruption/retry must finish that
    // solution (including review), not reinterpret the round as discussion.
    p.followUpMode = "update";
    await checkpoint();
    // Optional independent review shares the same budget and single reread allowance.
    if (p.input.review && !p.reviewDone) {
        run.excludeModel = p.solverId;
        try {
            const reviewed = await checkVisualDoubts(await solve("review"), true);
            if (reviewed.status === "discussion") throw new AIError("AI_RESPONSE_ERROR", false, 0, "JSON_SCHEMA_INVALID");
            if (reviewed.status !== "solved") return wait(reviewed.questions);
            p.result = sourceBackedResult(reviewed.result);
            p.reviewDone = true;
        } finally { run.excludeModel = undefined; }
    }
    p.questions = [];
    return { state: "answered" as const, payload: p };
}
