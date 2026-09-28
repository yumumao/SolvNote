import type { AiAccessTx } from "./types";
import { prisma } from "../prisma";
import { loadAIConfig } from "../ai-config/store";
import { emptyConfig, parseConfig } from "../ai-config/schema";
import { unprotect } from "../ai-config/vault";
import { AIRequestError } from "../ai-access";
import { requireLiveAiUser, requireTxAiUser } from "./account";
import { initializeLegacyAiGrants } from "./registration";
import { unprotectUserConfig } from "./private-vault";
import { mergeEffectiveConfig, privateRuntimeConfig } from "./compose";
import { listConfiguredSiteModels, siteModelFingerprint } from "./policy";
/** Server-only. Never pass this result into a response or a client component. No process cache. */
export async function loadEffectiveAIConfig(userId:string){
    await requireLiveAiUser(userId);
    // Config saves reconcile metadata atomically. Only bootstrap a legacy installation
    // here; polling an initialized task must not upsert config/policy on every GET.
    // Do not cache: each read still observes the live account, policy and grants.
    const [configuration, policy] = await Promise.all([
        prisma.aiConfiguration.findUnique({where:{id:"site"},select:{id:true}}),
        prisma.aiAccessPolicy.findUnique({where:{id:"site"},select:{id:true}}),
    ]);
    if (!configuration || !policy) await loadAIConfig();
    return prisma.$transaction(tx=>loadEffectiveAIConfigInTx(tx,userId));
}
export async function loadEffectiveAIConfigInTx(tx:AiAccessTx,userId:string){
        const user=await requireTxAiUser(tx,userId);
        if(!user.aiAccessInitialized)await initializeLegacyAiGrants(tx,userId);
        const row=await tx.aiConfiguration.findUniqueOrThrow({where:{id:"site"}});
        const site=parseConfig(unprotect(row.payload));
        const policy=await tx.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}});
        const grants=await tx.aiUserModelGrant.findMany({where:{userId,siteModel:{isAllowed:true}},include:{siteModel:true},orderBy:[{rank:"asc"},{modelId:"asc"}]});
        const allowed=new Set(user.role==="admin"?listConfiguredSiteModels(site).map(m=>m.id):grants.filter(g=>{const m=site.models.find(m=>m.id===g.modelId);return m && siteModelFingerprint(site,m)===g.siteModel.fingerprint;}).map(g=>g.modelId));
        const privateRow=await tx.userAiConfiguration.findUnique({where:{userId}});
        const privateConfig=privateRuntimeConfig(userId,privateRow?unprotectUserConfig(userId,privateRow.payload):emptyConfig());
        const config=mergeEffectiveConfig(site,allowed,privateConfig);
        return {config,revision:row.revision,revisions:{site:row.revision,policy:policy.revision,private:privateRow?.revision??0},siteModelIds:config.models.filter(m=>!m.id.startsWith("private/")).map(m=>m.id),privateModelIds:config.models.filter(m=>m.id.startsWith("private/")).map(m=>m.id)};
}
export async function assertModelAllowedForUser(userId:string,modelId:string):Promise<void>{
    const {config}=await loadEffectiveAIConfig(userId);
    if(!config.models.some(m=>m.id===modelId))throw new AIRequestError(403,"AI_MODEL_ACCESS_REVOKED");
}
/** Checks all models that contributed to persisted state; must run before decrypting a result. */
export async function assertModelsAllowedForUser(userId:string,ids:string[]){
    const effective=await loadEffectiveAIConfig(userId), allowed=new Set(effective.config.models.map(m=>m.id));
    if(ids.some(id=>!allowed.has(id)))throw new AIRequestError(403,"AI_MODEL_ACCESS_REVOKED");
    return effective;
}
export async function assertAiInputAllowed(userId:string,input:{imageBase64?:string;mode?:string;review?:boolean}){
    const effective=await loadEffectiveAIConfig(userId);
    const kind=input.imageBase64?"vision":"text";
    if(!effective.config.chains[kind].length)throw new AIRequestError(403,"AI_NO_ALLOWED_MODEL");
    if(input.mode==="transcribe" && !effective.config.chains.text.length)throw new AIRequestError(403,"AI_NO_ALLOWED_MODEL");
    return effective;
}
