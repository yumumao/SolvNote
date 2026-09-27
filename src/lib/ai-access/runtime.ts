import { prisma } from "../prisma";
import { AIError } from "../ai/transport";
import type { AIRun } from "../ai-jobs/context";
import type { PortableConfig } from "../ai-config/schema";
import type { AiAccessTx } from "./types";
import { assertModelsAllowedForUser, loadEffectiveAIConfig } from "./effective-config";

/** Include prior rounds: an allowed next model must not receive revoked model output. */
export async function assertRunContributors(run:AIRun,config:PortableConfig,db:Pick<AiAccessTx,"aiAttempt">=prisma){
    if(!run.userId)throw new AIError("AI_ACCESS_REVOKED");
    const ids=new Set(run.usedModelIds || []);
    if(run.conversationId || run.jobId){
        const attempts=await db.aiAttempt.findMany({
            where:run.conversationId?{job:{userId:run.userId,conversationId:run.conversationId}}:{jobId:run.jobId,job:{userId:run.userId}},
            select:{modelId:true},distinct:["modelId"],
        });
        for(const attempt of attempts)ids.add(attempt.modelId);
    }
    const allowed=new Set(config.models.map(m=>m.id));
    if([...ids].some(id=>!allowed.has(id)))throw new AIError("AI_ACCESS_REVOKED");
}
/** Internal worker errors are fixed codes, never auth/DB/provider error messages. */
export async function runtimeConfig(run:AIRun){
    if(!run.userId)throw new AIError("AI_ACCESS_REVOKED");
    try{
        const effective=await loadEffectiveAIConfig(run.userId);
        await assertRunContributors(run,effective.config);
        run.config=effective.config;
        return effective.config;
    }catch{throw new AIError("AI_ACCESS_REVOKED");}
}
export async function assertJobModelAccess(userId:string,jobId:string){
    const attempts=await prisma.aiAttempt.findMany({where:{jobId,job:{userId}},select:{modelId:true},distinct:["modelId"]});
    return assertModelsAllowedForUser(userId,attempts.map(a=>a.modelId));
}
export async function assertConversationModelAccess(userId:string,conversationId:string){
    const attempts=await prisma.aiAttempt.findMany({where:{job:{conversationId,userId}},select:{modelId:true},distinct:["modelId"]});
    return assertModelsAllowedForUser(userId,attempts.map(a=>a.modelId));
}
