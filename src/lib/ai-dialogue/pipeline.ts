import { callChain } from "../ai/chain";
import { aiRun } from "../ai-jobs/context";
import { AIError } from "../ai/transport";
import { DecisionSchema, parseJSON, RECOGNIZE_PROMPT, solvePrompt, parseTranscript } from "./protocol";
import type { DialoguePayload } from "./types";

import { detailCrops } from "./crops";
import { GEOMETRY_CHECK_PROMPT } from "./geometry-check";

/** Context is explicit and bounded; never silently summarize away geometry. */
export function dialogueContext(p: DialoguePayload) {
    const context = JSON.stringify({
        question: p.input.questionText, subject: p.input.subject,
        transcription: p.transcript, questionsToCheck: p.questions,
        ...(p.transcriptClarifications?.length ? {transcriptionAuthority:"user_clarified",transcriptionClarifications:p.transcriptClarifications} : p.userCorrectedTranscript ? {transcriptionAuthority:"user_corrected"} : {}),
        imageContext: { sourceImageAvailable: !!p.input.imageBase64, rereadsUsed: p.rereads, rereadLimit: 1 },
        messages: p.messages.map(m => ({ kind: m.kind, text: m.text, round: m.round })),
    });
    if (context.length > 200000) throw new AIError("AI_CONTEXT_LIMIT");
    return context;
}
export async function advanceDialogue(p: DialoguePayload, checkpoint: () => Promise<void>) {
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
    const humanReviewed=p.userCorrectedTranscript || !!p.transcriptClarifications?.length;
    if(image && geometry && !humanReviewed){
        const regions=[...geometry.regions,...geometry.angles.flatMap(a=>a.region?[a.region]:[])];
        detailImages=await detailCrops(rereadImage!,regions);
        if(geometry.angles.length && !p.geometryChecked){
            if(p.geometryCheckStarted || p.rereads>=1)return wait(["关键角标尚未核对完成，请补充具体角标说明或修订题设后继续，避免重复发送同一核对请求。"]);
            p.geometryCheckStarted=true;p.rereads++;
            await checkpoint();
            const checked=await callChain(GEOMETRY_CHECK_PROMPT,JSON.stringify({question:p.input.questionText,labelsToLocate:geometry.angles.map(a=>a.label),humanMessages:p.messages.filter(m=>m.kind==="question" || m.kind==="clarification").map(m=>m.text)}),rereadImage,
                parseTranscript,{role:"recognize",stage:"geometry_check",detailImages,question:["核对编号角的顶点与两条射线，不沿用初次角名猜测"]});
            const missing=geometry.angles.filter(a=>!checked.geometry?.angles.some(b=>b.label===a.label));
            if(missing.length || checked.uncertainties.length || checked.missingInformation.length){
                p.transcript={...checked,uncertainties:[...checked.uncertainties,...missing.map(a=>`编号角${a.label}的射线仍未确认`)].slice(0,8)};
                await checkpoint();
                return wait([...p.transcript.uncertainties,...checked.missingInformation].slice(0,8));
            }
            p.transcript=checked;p.geometryChecked=true;
            await checkpoint();
        }
    }
    const solve = async (stage: "solve" | "reread" | "review", modelId?: string, review = stage === "review") => {
        const decision = await callChain(solvePrompt(p.input.gradeSemester, review, p.input.language),
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
            p.transcript = await callChain(RECOGNIZE_PROMPT, dialogueContext(p), rereadImage,
                parseTranscript, { role: "recognize", stage: "reread", question: p.questions });
        } finally { run.excludeModel = excludedModel; }
        await checkpoint();
        // Even an inconclusive reader cannot bypass the responsible solver/reviewer.
        return solve(review ? "review" : "solve", modelId, review);
    };
    const decision = await checkVisualDoubts(await solve("solve", p.solverId));
    if (decision.status !== "solved") return wait(decision.questions);
    p.result = decision.result;
    // Optional independent review shares the same budget and single reread allowance.
    if (p.input.review && !p.reviewDone) {
        run.excludeModel = p.solverId;
        try {
            const reviewed = await checkVisualDoubts(await solve("review"), true);
            if (reviewed.status !== "solved") return wait(reviewed.questions);
            p.result = reviewed.result;
            p.reviewDone = true;
        } finally { run.excludeModel = undefined; }
    }
    p.questions = [];
    return { state: "answered" as const, payload: p };
}
