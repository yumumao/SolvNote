import type { PortableConfig } from "../ai-config/schema";
import { listConfiguredSiteModels, siteModelFingerprint } from "./policy";
import type { AiAccessTx } from "./types";
/** Called in the SAME transaction as config writes. Tombstones must never be deleted. */
export async function reconcileSiteModelAccess(tx:AiAccessTx,config:PortableConfig,bumpRevision=false){
    const existing=await tx.aiSiteModelAccess.findMany();
    const byId=new Map(existing.map(row=>[row.modelId,row]));
    const fingerprints=new Map(config.models.map(m=>[m.id,siteModelFingerprint(config,m)]));
    for(const [id,fp] of fingerprints){
        if(byId.has(id) && byId.get(id)!.fingerprint!==fp)throw Error("MODEL_ID_REUSED");
    }
    await tx.aiAccessPolicy.upsert({where:{id:"site"},create:{id:"site"},update:{}});
    let changed=false;
    const available=new Set(listConfiguredSiteModels(config).map(m=>m.id));
    for(const [modelId,fingerprint] of fingerprints){
        if(!byId.has(modelId)){
            await tx.aiSiteModelAccess.create({data:{modelId,fingerprint,isAllowed:available.has(modelId)}});changed=true;
        }
    }
    for(const old of existing){
        if(!available.has(old.modelId) && (old.isAllowed || old.defaultRank!==null)){
            await tx.aiSiteModelAccess.update({where:{modelId:old.modelId},data:{isAllowed:false,defaultRank:null}});changed=true;
        }
    }
    if(changed || bumpRevision)await tx.aiAccessPolicy.update({where:{id:"site"},data:{revision:{increment:1}}});
}
