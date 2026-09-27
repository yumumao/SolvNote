import { z } from "zod";
import { prisma } from "../prisma";
import { AIRequestError } from "../ai-access";
import { loadAIConfig } from "../ai-config/store";
import { listConfiguredSiteModels, assertDefaultModelSelection } from "./policy";
import { requireTxAiActor } from "./account";
import { conflict } from "./errors";
const ids=z.array(z.string().min(1).max(160)).max(200).refine(v=>new Set(v).size===v.length);
export const PolicyPatchSchema=z.object({revision:z.number().int().positive(),defaultModelIds:ids,allowedModelIds:ids}).strict();
export const GrantPatchSchema=z.object({revision:z.number().int().positive(),modelIds:ids}).strict();
export async function readSiteAccessPolicy(){
    const {config}=await loadAIConfig();
    return prisma.$transaction(async tx=>{
        const policy=await tx.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}});
        const rows=await tx.aiSiteModelAccess.findMany();
        const models=listConfiguredSiteModels(config).map(m=>{const row=rows.find(r=>r.modelId===m.id);return {...m,isAllowed:!!row?.isAllowed,defaultRank:row?.defaultRank??null};});
        return {revision:policy.revision,initialized:policy.initialized,models,defaultModelIds:models.filter(m=>m.defaultRank!==null).sort((a,b)=>a.defaultRank!-b.defaultRank!).map(m=>m.id)};
    });
}
export async function updateSiteAccessPolicy(adminId:string,raw:unknown,sessionVersion:number){
    const data=PolicyPatchSchema.parse(raw), current=await loadAIConfig({actor:{id:adminId,sessionVersion}});
    const available=new Set(listConfiguredSiteModels(current.config).map(m=>m.id));
    if(data.allowedModelIds.some(id=>!available.has(id)))throw Error("MODEL_NOT_AVAILABLE");
    assertDefaultModelSelection(data.defaultModelIds,new Set(data.allowedModelIds));
    await prisma.$transaction(async tx=>{
        await requireTxAiActor(tx,adminId,sessionVersion,true);
        const config=await tx.aiConfiguration.findUnique({where:{id:"site"}});
        if(config?.revision!==current.revision)conflict();
        const saved=await tx.aiAccessPolicy.updateMany({where:{id:"site",revision:data.revision},data:{revision:{increment:1},initialized:true}});
        if(saved.count!==1)conflict();
        await tx.aiSiteModelAccess.updateMany({data:{isAllowed:false,defaultRank:null}});
        await tx.aiSiteModelAccess.updateMany({where:{modelId:{in:data.allowedModelIds}},data:{isAllowed:true}});
        for(const [index,modelId] of data.defaultModelIds.entries())await tx.aiSiteModelAccess.update({where:{modelId},data:{defaultRank:index+1}});
    });
    return readSiteAccessPolicy();
}
export async function readUserSiteGrants(userId:string){
    const policy=await readSiteAccessPolicy();
    const user=await prisma.user.findUnique({where:{id:userId},select:{id:true}});
    if(!user)throw new AIRequestError(404,"USER_NOT_FOUND");
    const grants=await prisma.aiUserModelGrant.findMany({where:{userId},orderBy:[{rank:"asc"},{modelId:"asc"}],select:{modelId:true,source:true,rank:true}});
    return {revision:policy.revision,userId,grants,models:policy.models};
}
/** Replaces this user's complete snapshot. Other users and future defaults are untouched. */
export async function updateUserSiteGrants(adminId:string,userId:string,raw:unknown,sessionVersion:number){
    const data=GrantPatchSchema.parse(raw);await loadAIConfig({actor:{id:adminId,sessionVersion}});
    await prisma.$transaction(async tx=>{
        await requireTxAiActor(tx,adminId,sessionVersion,true);
        const target=await tx.user.findUnique({where:{id:userId},select:{id:true}});
        if(!target)throw new AIRequestError(404,"USER_NOT_FOUND");
        const rows=await tx.aiSiteModelAccess.findMany({where:{isAllowed:true,modelId:{in:data.modelIds}}});
        if(rows.length!==data.modelIds.length)throw Error("MODEL_NOT_AVAILABLE");
        const saved=await tx.aiAccessPolicy.updateMany({where:{id:"site",revision:data.revision},data:{revision:{increment:1}}});if(saved.count!==1)conflict();
        await tx.aiUserModelGrant.deleteMany({where:{userId}});
        for(const [index,modelId] of data.modelIds.entries())await tx.aiUserModelGrant.create({data:{userId,modelId,source:"admin",rank:index+1}});
        // Mark initialized before leaving tx, including previously dormant legacy users.
        await tx.user.update({where:{id:userId},data:{aiAccessInitialized:true,sessionVersion:{increment:1}}});
    });
    return readUserSiteGrants(userId);
}
