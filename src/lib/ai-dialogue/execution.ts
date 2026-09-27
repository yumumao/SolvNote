import { randomUUID } from "node:crypto";
import type { AiJob, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { protect, unprotect } from "../ai-config/vault";
import { aiRun } from "../ai-jobs/context";
import { failureState } from "../ai-jobs/store";
import { AIError } from "../ai/transport";
import { advanceDialogue } from "./pipeline";
import type { DialoguePayload } from "./types";
import { requireTxAiUser } from "../ai-access/account";
import { assertConversationModelAccess } from "../ai-access/runtime";
import { loadEffectiveAIConfigInTx } from "../ai-access/effective-config";
type Tx = Prisma.TransactionClient;
export async function recoverDialogue(tx: Tx, job: AiJob, now: Date) {
    if (!job.conversationId) return;
    const c = await tx.aiConversation.findFirst({where:{id:job.conversationId,activeJobId:job.id,state:{in:["active","cancelling"]}}});
    if (!c) return;
    await tx.aiConversation.updateMany({where:{id:c.id,activeJobId:job.id},data:{
        state:"unknown",revision:{increment:1},
        roundElapsedMs:Math.min(c.timeLimitMs,c.roundElapsedMs+Math.max(0,now.getTime()-(job.startedAt || job.updatedAt).getTime())),
    }});
}
async function guard(tx: Tx, job: AiJob, owner: string) {
    const now=new Date();
    const current=await tx.aiJob.findUnique({where:{id:job.id}});
    if(current?.cancelRequested)throw new AIError("AI_CANCELLED");
    try {
        await requireTxAiUser(tx,job.userId);
        const effective=await loadEffectiveAIConfigInTx(tx,job.userId);
        const attempts=await tx.aiAttempt.findMany({where:{job:{conversationId:job.conversationId!,userId:job.userId}},select:{modelId:true}});
        if(attempts.some(a=>!effective.config.models.some(m=>m.id===a.modelId)))throw Error();
    }catch{throw new AIError("AI_ACCESS_REVOKED");}
    const lease=await tx.aiWorkerLease.findFirst({where:{id:"site",owner,until:{gt:now}}});
    if(!lease || current?.state!=="running" || current.leaseOwner!==owner || !current.leaseUntil || current.leaseUntil<=now)
        throw new AIError("AI_ACCEPTANCE_UNKNOWN");
}
export async function executeDialogueJob(job: AiJob, owner: string, controller: AbortController) {
    const start=Date.now();
    const c=await prisma.aiConversation.findFirst({where:{id:job.conversationId!,activeJobId:job.id}});
    if(!c) throw new AIError("AI_ACCEPTANCE_UNKNOWN");
    const remaining=Math.max(0,c.timeLimitMs-c.roundElapsedMs);
    const timer=setTimeout(()=>controller.abort(),Math.max(1,remaining));
    let completed=false;
    const elapsed=()=>Math.min(remaining,Math.max(0,Date.now()-start));
    try {
        try { await assertConversationModelAccess(job.userId,c.id); } catch { throw new AIError("AI_ACCESS_REVOKED"); }
        if(c.state!=="active")throw new AIError("AI_CANCELLED");
        if(!remaining || c.roundAttempts>=c.attemptLimit)throw new AIError("AI_BUDGET_EXHAUSTED");
        const payload=unprotect<DialoguePayload>(c.payload);
        const checkpoint=async()=>prisma.$transaction(async tx=>{
            await guard(tx,job,owner);
            const changed=await tx.aiConversation.updateMany({where:{id:c.id,activeJobId:job.id,state:"active"},data:{payload:protect(payload),revision:{increment:1}}});
            if(changed.count!==1)throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        });
        const result=await aiRun.run({userId:job.userId,jobId:job.id,conversationId:c.id,round:c.roundsUsed+1,leaseOwner:owner,signal:controller.signal,
            deadline:start+remaining,attempts:c.roundAttempts,startingAttempts:c.roundAttempts,maxAttempts:c.attemptLimit},
            ()=>advanceDialogue(payload,checkpoint));
        completed=true;
        if(controller.signal.aborted)throw new AIError("AI_ACCEPTANCE_UNKNOWN");
        await prisma.$transaction(async tx=>{
            await guard(tx,job,owner);
            const text=result.state==="answered"?JSON.stringify(payload.result):payload.questions.join("\n");
            if(payload.messages.length>=300 || payload.messages.reduce((n,m)=>n+m.text.length,0)+text.length>180000)throw new AIError("AI_CONTEXT_LIMIT");
            payload.messages.push({id:randomUUID(),kind:result.state==="answered"?"answer":"notice",text,round:c.roundsUsed+1,at:new Date().toISOString()});
            const changed=await tx.aiConversation.updateMany({where:{id:c.id,activeJobId:job.id,state:"active"},data:{
                state:result.state,payload:protect(payload),revision:{increment:1},roundElapsedMs:{increment:elapsed()},
                ...(result.state==="answered"?{roundsUsed:{increment:1},roundOpen:false}:{}),
            }});
            if(changed.count!==1)throw new AIError("AI_ACCEPTANCE_UNKNOWN");
            await tx.aiJob.update({where:{id:job.id},data:{state:"success",result:protect({conversationId:c.id,state:result.state}),leaseOwner:null,leaseUntil:null}});
        });
    } catch(error) {
        const code=completed ? "AI_ACCEPTANCE_UNKNOWN" : error instanceof AIError?error.code:"AI_INTERNAL_ERROR";
        await prisma.$transaction(async tx=>{
            const current=await tx.aiJob.findUnique({where:{id:job.id}});
            const state=failureState(code,!!current?.cancelRequested || code==="AI_CANCELLED" || code==="AI_USER_DISABLED" || code==="AI_ACCESS_REVOKED");
            const changed=await tx.aiJob.updateMany({where:{id:job.id,state:"running",leaseOwner:owner},data:{state,errorCode:code,leaseOwner:null,leaseUntil:null}});
            if(!changed.count)return;
            await tx.aiAttempt.updateMany({where:{jobId:job.id,state:"running"},data:{state:state==="cancelled"?"cancelled":"unknown",errorCode:code,finishedAt:new Date()}});
            await tx.aiConversation.updateMany({where:{id:c.id,activeJobId:job.id,state:{in:["active","cancelling"]}},data:{state,revision:{increment:1},roundElapsedMs:{increment:elapsed()}}});
        });
    } finally {clearTimeout(timer);}
}
