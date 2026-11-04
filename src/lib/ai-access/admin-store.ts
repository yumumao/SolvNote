import { z } from "zod";
import { prisma } from "../prisma";
import { AIRequestError } from "../ai-access";
import { loadAIConfig } from "../ai-config/store";
import { emptyConfig, type PortableConfig } from "../ai-config/schema";
import { listConfiguredSiteModels, assertDefaultModelSelection, siteModelFingerprint } from "./policy";
import { requireTxAiActor } from "./account";
import { conflict } from "./errors";
import { applyOrder, ModelOrderSchema, readOrder, replaceSiteOrder, validateOrder, type ModelOrder } from "./model-order";
import { privateRuntimeConfig, mergeEffectiveConfig } from "./compose";
import { unprotectUserConfig } from "./private-vault";

const ids=z.array(z.string().min(1).max(160)).max(200).refine(v=>new Set(v).size===v.length);
export const PolicyPatchSchema=z.object({revision:z.number().int().positive(),defaultModelIds:ids,allowedModelIds:ids,defaultChains:ModelOrderSchema.optional()}).strict();
export const GrantPatchSchema=z.object({revision:z.number().int().positive(),modelIds:ids,chains:ModelOrderSchema.optional(),orderRevision:z.number().int().nonnegative().optional()}).strict()
    .refine(v=>(v.chains===undefined)===(v.orderRevision===undefined));

function siteOrder(config:PortableConfig, selected:string[], preferred:ModelOrder):ModelOrder {
    const models=listConfiguredSiteModels(config);
    const chain=(kind:"text"|"vision")=>selected.filter(id=>models.some(m=>m.id===id&&m.capabilities.includes(kind)));
    return applyOrder({text:chain("text"),vision:chain("vision")},preferred);
}
function existingSiteOrder(config:PortableConfig,selected:string[],preferred:ModelOrder):ModelOrder {
    // Match runtime fallback for upgraded users without saved preferences.
    const catalog=config.models.filter(m=>selected.includes(m.id)).map(m=>m.id);
    return applyOrder(siteOrder(config,catalog,config.chains),preferred);
}

export async function readSiteAccessPolicy(){
    const {config}=await loadAIConfig();
    return prisma.$transaction(async tx=>{
        const policy=await tx.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}});
        const rows=await tx.aiSiteModelAccess.findMany();
        const models=listConfiguredSiteModels(config).map(m=>{const row=rows.find(r=>r.modelId===m.id);return {...m,isAllowed:!!row?.isAllowed,defaultRank:row?.defaultRank??null};});
        const defaultModelIds=models.filter(m=>m.isAllowed&&m.defaultRank!==null).sort((a,b)=>a.defaultRank!-b.defaultRank!).map(m=>m.id);
        return {revision:policy.revision,initialized:policy.initialized,models,defaultModelIds,defaultChains:siteOrder(config,defaultModelIds,readOrder(policy.defaultOrder))};
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
        const policy=await tx.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}});
        const fallback=siteOrder(current.config,data.defaultModelIds,readOrder(policy.defaultOrder));
        const chains=data.defaultChains??fallback;
        validateOrder(chains,fallback);
        const saved=await tx.aiAccessPolicy.updateMany({where:{id:"site",revision:data.revision},data:{revision:{increment:1},initialized:true,defaultOrder:JSON.stringify(chains)}});
        if(saved.count!==1)conflict();
        await tx.aiSiteModelAccess.updateMany({data:{isAllowed:false,defaultRank:null}});
        await tx.aiSiteModelAccess.updateMany({where:{modelId:{in:data.allowedModelIds}},data:{isAllowed:true}});
        for(const [index,modelId] of data.defaultModelIds.entries())await tx.aiSiteModelAccess.update({where:{modelId},data:{defaultRank:index+1}});
    });
    return readSiteAccessPolicy();
}
export async function readUserSiteGrants(userId:string){
    const policy=await readSiteAccessPolicy();
    const {config}=await loadAIConfig();
    return prisma.$transaction(async tx=>{
        // Admin may manage an inactive target. Return built-in metadata only.
        const user=await tx.user.findUnique({where:{id:userId},select:{id:true,aiModelOrder:true,aiOrderRevision:true}});
        if(!user)throw new AIRequestError(404,"USER_NOT_FOUND");
        const grants=await tx.aiUserModelGrant.findMany({where:{userId},orderBy:[{rank:"asc"},{modelId:"asc"}],select:{modelId:true,source:true,rank:true}});
        const allowed=grants.filter(g=>policy.models.some(m=>m.id===g.modelId&&m.isAllowed)).map(g=>g.modelId);
        return {revision:policy.revision,userId,grants,models:policy.models,orderRevision:user.aiOrderRevision,chains:existingSiteOrder(config,allowed,readOrder(user.aiModelOrder))};
    });
}
/** Replace built-in authorization and relative order, preserving personal model slots. */
export async function updateUserSiteGrants(adminId:string,userId:string,raw:unknown,sessionVersion:number){
    const data=GrantPatchSchema.parse(raw),current=await loadAIConfig({actor:{id:adminId,sessionVersion}});
    await prisma.$transaction(async tx=>{
        await requireTxAiActor(tx,adminId,sessionVersion,true);
        const target=await tx.user.findUnique({where:{id:userId},select:{id:true,role:true,aiAccessInitialized:true,aiModelOrder:true,aiOrderRevision:true}});
        if(!target)throw new AIRequestError(404,"USER_NOT_FOUND");
        const config=await tx.aiConfiguration.findUnique({where:{id:"site"}});
        if(config?.revision!==current.revision)conflict();
        if(data.orderRevision!==undefined&&data.orderRevision!==target.aiOrderRevision)conflict();
        const rows=await tx.aiSiteModelAccess.findMany({where:{isAllowed:true,modelId:{in:data.modelIds}}});
        const available=new Set(listConfiguredSiteModels(current.config).map(m=>m.id));
        if(rows.length!==data.modelIds.length||data.modelIds.some(id=>!available.has(id)))throw Error("MODEL_NOT_AVAILABLE");
        const previous=await tx.aiUserModelGrant.findMany({where:{userId,siteModel:{isAllowed:true}},include:{siteModel:true}});
        const previousIds=previous.filter(g=>{const model=current.config.models.find(m=>m.id===g.modelId);return model&&siteModelFingerprint(current.config,model)===g.siteModel.fingerprint;}).map(g=>g.modelId);
        const rawOrder=readOrder(target.aiModelOrder);
        const liveIds=target.role==="admin"?[...available]:!target.aiAccessInitialized?(await tx.aiSiteModelAccess.findMany({where:{isAllowed:true},select:{modelId:true}})).map(m=>m.modelId):previousIds;
        // Resolve actual current slots, including newly imported personal models and
        // excluding revoked ones. Secrets stay local to this transaction and never
        // enter the stored preference or administrator response.
        const privateRow=await tx.userAiConfiguration.findUnique({where:{userId}});
        const personal=privateRuntimeConfig(userId,privateRow?unprotectUserConfig(userId,privateRow.payload):emptyConfig());
        const stored=applyOrder(mergeEffectiveConfig(current.config,new Set(liveIds),personal).chains,rawOrder);
        const fallback=existingSiteOrder(current.config,data.modelIds,stored);
        const chains=data.chains??fallback;
        validateOrder(chains,fallback);
        const saved=await tx.aiAccessPolicy.updateMany({where:{id:"site",revision:data.revision},data:{revision:{increment:1}}});
        if(saved.count!==1)conflict();
        await tx.aiUserModelGrant.deleteMany({where:{userId}});
        for(const [index,modelId] of data.modelIds.entries())await tx.aiUserModelGrant.create({data:{userId,modelId,source:"admin",rank:index+1}});
        await tx.user.update({where:{id:userId},data:{aiAccessInitialized:true,sessionVersion:{increment:1},aiModelOrder:JSON.stringify(replaceSiteOrder(stored,chains)),aiOrderRevision:{increment:1}}});
    });
    return readUserSiteGrants(userId);
}
