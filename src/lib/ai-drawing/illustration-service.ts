import {prisma} from "../prisma";
import {protect} from "../ai-config/vault";
import {aiRun,ATTEMPT_MS} from "../ai-jobs/context";
import type {JobInput} from "../ai-jobs/schema";
import type {AiAccessTx} from "../ai-access/types";
import {AIError} from "../ai/transport";
import {IllustrationInput,type IllustrationResult} from "./illustration-schema";
import {requireIllustrationAccess} from "./illustration-settings";
import {sendMiniMaxImage} from "./minimax";
export async function validateIllustrationInput(input:JobInput,userId:string,tx?:AiAccessTx){
    if(!input.confirmIllustration || !input.illustrationRevision || input.imageBase64 || input.originalImageBase64 || input.drawingPlan || input.errorItemId || input.answerText || input.analysis || input.review || input.mode==="transcribe")throw Error("INVALID_REQUEST");
    // Validate before reading credentials or recording a dispatch.
    IllustrationInput.parse({prompt:input.questionText,ratio:input.illustrationRatio,model:"image-01"});
    return requireIllustrationAccess(userId,input.illustrationRevision,tx);
}
export async function executeIllustration(input:JobInput):Promise<IllustrationResult>{
    const run=aiRun.getStore();
    if(!run?.userId || !run.jobId || !run.leaseOwner)throw new AIError("AI_INTERNAL_ERROR");
    if(run.signal.aborted)throw new AIError("AI_CANCELLED");
    if(run.attempts!==0 || run.deadline<=Date.now())throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    const {attempt,choice}=await prisma.$transaction(async tx=>{
        const job=await tx.aiJob.findUnique({where:{id:run.jobId}});
        if(job?.cancelRequested)throw new AIError("AI_CANCELLED");
        if(!job || job.userId!==run.userId || job.kind!=="illustration")throw new AIError("AI_ACCESS_REVOKED");
        const choice=await validateIllustrationInput(input,run.userId!,tx);
        const now=new Date();
        if(!await tx.aiWorkerLease.findFirst({where:{id:"site",owner:run.leaseOwner,until:{gt:now}}}))throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        const changed=await tx.aiJob.updateMany({where:{id:run.jobId,state:"running",cancelRequested:false,leaseOwner:run.leaseOwner,leaseUntil:{gt:now},attempts:0},data:{attempts:1}});
        if(changed.count!==1)throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        const attempt=await tx.aiAttempt.create({data:{jobId:run.jobId!,modelId:`media:minimax:${choice.model}`,state:"running",metadata:protect({stage:"illustration",modelName:choice.model,model:choice.model,providerName:choice.provider.name,withImage:false,questions:[]})}});
        return {attempt,choice};
    });
    run.attempts=1;
    async function finish(state:string,errorCode?:string){
        try{
            const changed=await prisma.aiAttempt.updateMany({where:{id:attempt.id,state:"running",job:{state:"running",leaseOwner:run!.leaseOwner,leaseUntil:{gt:new Date()}}},data:{state,errorCode,finishedAt:new Date()}});
            if(changed.count!==1)throw Error();
        }catch{throw new AIError("AI_ACCEPTANCE_UNKNOWN");}
    }
    let imageDataUrl:string;
    try{
        if(run.signal.aborted)throw new AIError("AI_CANCELLED");
        const signal=AbortSignal.any([run.signal,AbortSignal.timeout(Math.max(1,Math.min(ATTEMPT_MS,run.deadline-Date.now())))]);
        imageDataUrl=await sendMiniMaxImage(choice.provider,{prompt:input.questionText,ratio:input.illustrationRatio!,model:choice.model},signal);
    }catch(e){
        const code=e instanceof AIError?e.code:"AI_ACCEPTANCE_UNKNOWN";
        await finish(code==="AI_CANCELLED"?"cancelled":code==="AI_ACCEPTANCE_UNKNOWN"?"unknown":"failed",code);
        throw new AIError(code);
    }
    // Preserve the successful paid-call audit even if publishing is subsequently revoked.
    await finish("success");
    const current=await requireIllustrationAccess(run.userId,input.illustrationRevision);
    if(current.fingerprint!==choice.fingerprint)throw new AIError("AI_ILLUSTRATION_SETTINGS_CHANGED");
    if(run.signal.aborted)throw new AIError("AI_CANCELLED");
    return {type:"illustration",imageDataUrl,modelName:choice.model,providerName:choice.provider.name};
}
