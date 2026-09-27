import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { AIRequestError } from "../ai-access";
import { protect, unprotect } from "../ai-config/vault";
import { JobInputSchema } from "../ai-jobs/schema";
import { calculateGrade } from "../grade-calculator";
import { DEFAULT_ACTIVE_MS, DEFAULT_ATTEMPTS, MAX_ACTIVE_MS, MAX_ATTEMPTS, MAX_ROUNDS, type DialoguePayload, type DialogueView, type StepMetadata } from "./types";
export function dialogueError(code: string, status = 409): never { throw new AIRequestError(status, code); }
import { requireLiveAiUser, requireTxAiUser } from "../ai-access/account";
import { assertAiInputAllowed, assertModelsAllowedForUser } from "../ai-access/effective-config";
import { assertConversationModelAccess } from "../ai-access/runtime";
type Tx = Prisma.TransactionClient;
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const ActionSchema = z.object({
    kind: z.enum(["save", "continue", "ask", "cancel", "extend_rounds", "extend_budget"]),
    correctedTranscript: z.string().trim().min(1).max(40000).optional(),
    revision: z.number().int().min(0), text: z.string().trim().max(10000).default(""),
    imageBase64: z.string().max(12 * 1024 * 1024).optional(),
    originalImageBase64: z.string().max(12 * 1024 * 1024).optional(),
    amount: z.number().int().min(1).max(20).optional(),
}).strict();
async function account(tx: Tx, userId: string, admin = false) {
    await requireTxAiUser(tx,userId);
    const user = await tx.user.findUnique({where:{id:userId}});
    if (!user?.isActive || (admin && user.role !== "admin")) dialogueError("FORBIDDEN",403);
    return user;
}
async function queueRoom(tx: Tx, userId: string) {
    if (await tx.aiJob.count({where:{userId,state:{in:["pending","running"]}}}) >= 5 ||
        await tx.aiJob.count({where:{state:{in:["pending","running"]}}}) >= 30) dialogueError("AI_QUEUE_FULL",429);
}
const forever = () => new Date("9999-12-31T00:00:00Z");
function message(p: DialoguePayload, kind: "question" | "clarification" | "notice", text: string, round: number) {
    if (p.messages.length >= 300 || p.messages.reduce((n,m)=>n+m.text.length,0) + text.length > 180000)
        dialogueError("DIALOGUE_CONTEXT_LIMIT");
    p.messages.push({id:randomUUID(),kind,text,round,at:new Date().toISOString()});
}
export async function getDefaults() {
    return await prisma.aiDialogueSettings.findUnique({where:{id:"site"}}) || {defaultRounds:10,revision:0};
}
export async function updateDefaults(userId: string, raw: unknown) {
    const data = z.object({defaultRounds:z.number().int().min(1).max(MAX_ROUNDS),revision:z.number().int().min(0)}).strict().parse(raw);
    return prisma.$transaction(async tx => {
        await account(tx,userId,true);
        await tx.aiDialogueSettings.upsert({where:{id:"site"},create:{id:"site"},update:{}});
        const saved=await tx.aiDialogueSettings.updateMany({where:{id:"site",revision:data.revision},data:{defaultRounds:data.defaultRounds,revision:{increment:1}}});
        if(!saved.count) dialogueError("DIALOGUE_CONFLICT");
        return {defaultRounds:data.defaultRounds,revision:data.revision+1};
    });
}
export async function createConversation(userId: string, raw: unknown, key: string) {
    requestKey.parse(key);
    const input = JobInputSchema.parse(raw);
    await assertAiInputAllowed(userId,input);
    // The immutable submitted input is stored encrypted for idempotency, before defaults enrichment.
    const submitted = protect(input);
    return prisma.$transaction(async tx => {
        const user=await account(tx,userId);
        const prior=await tx.aiJob.findUnique({where:{userId_requestKey:{userId,requestKey:`dlg:${key}`}}});
        if(prior?.conversationId){
            const receipt=await tx.aiConversationAction.findUnique({where:{conversationId_requestKey:{conversationId:prior.conversationId,requestKey:"initial"}}});
            if(!receipt || JSON.stringify(unprotect(receipt.payload))!==JSON.stringify(input)) dialogueError("REQUEST_CONFLICT");
            return prior.conversationId;
        }
        await queueRoom(tx,userId);
        if(await tx.aiConversation.count({where:{userId,state:{in:["active","awaiting_user","cancelling"]}}})>=100) dialogueError("DIALOGUE_STORAGE_LIMIT",429);
        if(input.subjectId){
            const subject=await tx.subject.findFirst({where:{id:input.subjectId,userId}});
            if(!subject) dialogueError("NOT_FOUND",404);
            input.subject=subject.name;
        }
        if(!input.gradeSemester && user.educationStage && user.enrollmentYear)
            input.gradeSemester=calculateGrade(user.educationStage,user.enrollmentYear,new Date(),"zh");
        const defaults=await tx.aiDialogueSettings.findUnique({where:{id:"site"}});
        const payload:DialoguePayload={input,messages:[],questions:[],rereads:0};
        message(payload,"question",input.questionText || "已提交题图，请识别并解题。",1);
        const c=await tx.aiConversation.create({data:{userId,roundLimit:defaults?.defaultRounds||10,payload:protect(payload)}});
        const job=await tx.aiJob.create({data:{userId,conversationId:c.id,kind:"dialogue",requestKey:`dlg:${key}`,input:protect({questionText:"conversation"}),expiresAt:forever()}});
        await tx.aiConversation.update({where:{id:c.id},data:{activeJobId:job.id}});
        await tx.aiConversationAction.create({data:{conversationId:c.id,requestKey:"initial",payload:submitted}});
        return c.id;
    },{timeout:10000});
}
export async function actConversation(userId:string,id:string,raw:unknown,key:string) {
    requestKey.parse(key);const action=ActionSchema.parse(raw);
    await requireLiveAiUser(userId);
    // Cancellation is always permitted; all content-changing/resuming actions revalidate prior contributors.
    if(action.kind!=="cancel"){
        const effective=await assertConversationModelAccess(userId,id);
        if(!effective.config.models.length)dialogueError("AI_MODEL_ACCESS_REVOKED",403);
    }
    return prisma.$transaction(async tx=>{
        const user=await account(tx,userId);
        const c=await tx.aiConversation.findFirst({where:{id,userId}});
        if(!c) dialogueError("NOT_FOUND",404);
        const old=await tx.aiConversationAction.findUnique({where:{conversationId_requestKey:{conversationId:id,requestKey:key}}});
        if(old){if(JSON.stringify(unprotect(old.payload))!==JSON.stringify(action))dialogueError("REQUEST_CONFLICT");return;}
        if(c.revision!==action.revision)dialogueError("DIALOGUE_CONFLICT");
        const p=unprotect<DialoguePayload>(c.payload);
        if(action.correctedTranscript && (!["save","continue","ask"].includes(action.kind) || action.imageBase64))dialogueError("INVALID_REQUEST",400);
        const data:Prisma.AiConversationUpdateManyMutationInput={revision:{increment:1}};
        const active = c.state === "active" || c.state === "cancelling";
        if(c.state === "unknown")dialogueError("DIALOGUE_UNKNOWN");
        if(action.kind==="extend_rounds" || action.kind==="extend_budget"){
            if(user.role!=="admin")dialogueError("FORBIDDEN",403);
            if(active)dialogueError("DIALOGUE_BUSY");
            if(action.kind==="extend_rounds"){
                if(!action.amount || c.roundLimit+action.amount>MAX_ROUNDS)dialogueError("DIALOGUE_LIMIT_INVALID",400);
                data.roundLimit=c.roundLimit+action.amount;
                message(p,"notice",`管理员确认追加${action.amount}轮问答。`,c.roundsUsed);
            }else{
                if(!c.roundOpen || c.attemptLimit+4>MAX_ATTEMPTS || c.timeLimitMs+DEFAULT_ACTIVE_MS>MAX_ACTIVE_MS)dialogueError("DIALOGUE_LIMIT_INVALID",400);
                data.attemptLimit=c.attemptLimit+4;data.timeLimitMs=c.timeLimitMs+DEFAULT_ACTIVE_MS;
                message(p,"notice","管理员确认当前轮追加4次AI调用及10分钟活动时间，尚未发起调用。",c.roundsUsed+1);
            }
        }else if(action.kind==="cancel"){
            if(!active)dialogueError("DIALOGUE_NOT_READY");
            if(c.activeJobId){
                await tx.aiJob.updateMany({where:{id:c.activeJobId,state:"pending"},data:{state:"cancelled",cancelRequested:true}});
                await tx.aiJob.updateMany({where:{id:c.activeJobId,state:"running"},data:{cancelRequested:true}});
                const job=await tx.aiJob.findUnique({where:{id:c.activeJobId}});
                data.state=job?.state==="running"?"cancelling":"cancelled";
                if(job?.state!=="running")data.activeJobId=null;
            }else data.state="cancelled";
        }else{
            if(active)dialogueError("DIALOGUE_BUSY");
            if(action.kind==="ask"){
                if(c.state!=="answered" || c.roundOpen)dialogueError("DIALOGUE_NOT_READY");
                if(c.roundsUsed>=c.roundLimit)dialogueError("DIALOGUE_ROUND_LIMIT");
                if(!action.text && !action.correctedTranscript)dialogueError("DIALOGUE_TEXT_REQUIRED",400);
                data.roundOpen=true;data.roundAttempts=0;data.roundElapsedMs=0;
                data.attemptLimit=DEFAULT_ATTEMPTS;data.timeLimitMs=DEFAULT_ACTIVE_MS;
                p.solverId=undefined;p.rereads=0;p.reviewDone=false;p.questions=[];
            }else{
                if(!c.roundOpen || c.state==="cancelled")dialogueError("DIALOGUE_NOT_READY");
                if(action.kind==="save" && !action.text && !action.imageBase64 && !action.correctedTranscript)dialogueError("DIALOGUE_TEXT_REQUIRED",400);
            }
            if(action.originalImageBase64 && !action.imageBase64)dialogueError("INVALID_IMAGE",400);
            if(action.imageBase64){
                p.input=JobInputSchema.parse({...p.input,mode:"transcribe",imageBase64:action.imageBase64,originalImageBase64:action.originalImageBase64 || action.imageBase64});
                p.transcript=undefined;p.reviewDone=false;p.geometryCheckStarted=false;p.geometryChecked=false;p.userCorrectedTranscript=false;
            }
            if(action.correctedTranscript){
                p.transcript={text:action.correctedTranscript,facts:[],uncertainties:[],missingInformation:[]};
                p.userCorrectedTranscript=true;p.geometryCheckStarted=false;p.geometryChecked=false;p.reviewDone=false;p.questions=[];
                message(p,"clarification",`人工已完整修订题设，以本版为准：\n${action.correctedTranscript}`,c.roundsUsed+1);
            }
            if(action.text || action.imageBase64)
                message(p,action.kind==="ask"?"question":"clarification",action.text || "用户补充了题图，旧转录失效。",c.roundsUsed+1);
            if(action.kind!=="save"){
                if(action.kind!=="ask" && (c.roundAttempts>=c.attemptLimit || c.roundElapsedMs>=c.timeLimitMs))dialogueError("DIALOGUE_CALL_LIMIT");
                await queueRoom(tx,userId);
                const job=await tx.aiJob.create({data:{userId,conversationId:id,kind:"dialogue",requestKey:`dlg:${id}:${key}`,input:protect({questionText:"conversation"}),expiresAt:forever()}});
                data.activeJobId=job.id;data.state="active";
            }
        }
        data.payload=protect(p);
        const updated=await tx.aiConversation.updateMany({where:{id,userId,revision:action.revision},data});
        if(updated.count!==1)dialogueError("DIALOGUE_CONFLICT");
        await tx.aiConversationAction.create({data:{conversationId:id,requestKey:key,payload:protect(action)}});
    },{timeout:10000});
}
export async function readConversation(userId:string,id:string,includeImages=false):Promise<DialogueView|null>{
    const c=await prisma.aiConversation.findFirst({where:{id,userId}});if(!c)return null;
    await requireLiveAiUser(userId);
    const attempts=await prisma.aiAttempt.findMany({where:{job:{conversationId:id}},orderBy:[{startedAt:"asc"},{id:"asc"}]});
    await assertModelsAllowedForUser(userId,attempts.map(a=>a.modelId));
    const p=unprotect<DialoguePayload>(c.payload);
    const job=c.activeJobId?await prisma.aiJob.findUnique({where:{id:c.activeJobId},select:{errorCode:true}}):null;
    const input={...p.input};if(!includeImages){delete input.imageBase64;delete input.originalImageBase64;}
    const user=await prisma.user.findUnique({where:{id:userId},select:{role:true,isActive:true}});
    if(!user?.isActive)return null;
    return {id:c.id,state:c.state,revision:c.revision,roundsUsed:c.roundsUsed,roundLimit:c.roundLimit,roundOpen:c.roundOpen,
        roundAttempts:c.roundAttempts,attemptLimit:c.attemptLimit,roundElapsedMs:c.roundElapsedMs,timeLimitMs:c.timeLimitMs,
        isAdmin:user.role==="admin",activeJobId:c.activeJobId,errorCode:job?.errorCode,
        input,transcript:p.transcript,userCorrectedTranscript:p.userCorrectedTranscript,geometryChecked:p.geometryChecked,messages:p.messages,questions:p.questions,result:c.state==="answered"?p.result:undefined,updatedAt:c.updatedAt,
        steps:attempts.map(a=>({id:a.id,modelId:a.modelId,state:a.state,errorCode:a.errorCode,startedAt:a.startedAt,finishedAt:a.finishedAt,...(a.metadata?unprotect<StepMetadata>(a.metadata):{})})),
    };
}
export async function deleteConversation(userId:string,id:string,revision:number){
    return prisma.$transaction(async tx=>{
        await account(tx,userId);const c=await tx.aiConversation.findFirst({where:{id,userId}});if(!c)dialogueError("NOT_FOUND",404);
        if(c.state==="active" || c.state==="cancelling")dialogueError("DIALOGUE_BUSY");
        if(c.revision!==revision)dialogueError("DIALOGUE_CONFLICT");
        await tx.aiConversation.delete({where:{id}});
    });
}
