import type { AiAccessTx } from "./types";
import { buildNewUserSiteGrants } from "./policy";
/** MAIN calls after creating the user (aiAccessInitialized=true), inside its transaction.
 * Reads only metadata in tx: no config file, master key, network or nested transaction. */
export async function createInitialAiGrants(tx:AiAccessTx,userId:string):Promise<void>{
    const defaults=await tx.aiSiteModelAccess.findMany({where:{isAllowed:true,defaultRank:{not:null}},orderBy:{defaultRank:"asc"},take:3});
    for(const grant of buildNewUserSiteGrants(defaults.map(m=>m.modelId))){
        await tx.aiUserModelGrant.create({data:{userId,...grant}});
    }
}
/** Atomic one-shot initialization: revocation must never become an invitation to re-grant. */
export async function initializeLegacyAiGrants(tx:AiAccessTx,userId:string):Promise<void>{
    const won=await tx.user.updateMany({where:{id:userId,aiAccessInitialized:false},data:{aiAccessInitialized:true}});
    if(won.count!==1)return;
    const models=await tx.aiSiteModelAccess.findMany({where:{isAllowed:true},orderBy:{modelId:"asc"}});
    for(const model of models)await tx.aiUserModelGrant.upsert({where:{userId_modelId:{userId,modelId:model.modelId}},create:{userId,modelId:model.modelId,source:"compatibility"},update:{}});
}
