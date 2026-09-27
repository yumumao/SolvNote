import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { getAppConfig } from "../config";
import { migrateLegacy } from "./legacy";
import { parseConfig, type PortableConfig } from "./schema";
import { protect, unprotect, masterKey } from "./vault";
import { reconcileSiteModelAccess } from "../ai-access/reconcile";
import { AIRequestError } from "../ai-access";
import { assertAdminActor } from "../user-management/admin-actor";
export type AiConfigActor={id:string;sessionVersion:number};
async function requireConfigActor(tx:Prisma.TransactionClient,actor:AiConfigActor){
    if(!Number.isSafeInteger(actor.sessionVersion) || actor.sessionVersion<0)throw new AIRequestError(403,"AI_ACCESS_REVOKED");
    await assertAdminActor(tx,actor.id,actor.sessionVersion);
}
/** Read-only previews never create metadata, configuration rows or keys. */
export async function loadAIConfig(options:{persist?:boolean;actor?:AiConfigActor}={}){
    const row=await prisma.aiConfiguration.findUnique({where:{id:"site"}});
    const config=row?parseConfig(unprotect(row.payload)):migrateLegacy(getAppConfig());
    if(options.persist===false)return {config,revision:row?.revision??0};
    return prisma.$transaction(async tx=>{
        if(options.actor)await requireConfigActor(tx,options.actor);
        if(!row)masterKey(true);
        const current=await tx.aiConfiguration.upsert({where:{id:"site"},create:{id:"site",payload:protect(config)},update:{}});
        const saved=parseConfig(unprotect(current.payload));
        await reconcileSiteModelAccess(tx,saved);
        return {config:saved,revision:current.revision};
    });
}
export async function saveAIConfig(config:PortableConfig,expectedRevision:number,actor?:AiConfigActor){
    const parsed=parseConfig(config), payload=protect(parsed);
    try{
        await prisma.$transaction(async tx=>{
            if(actor)await requireConfigActor(tx,actor);
            const previous=await tx.aiConfiguration.findUnique({where:{id:"site"}});
            if(previous)await reconcileSiteModelAccess(tx,parseConfig(unprotect(previous.payload)));
            if(expectedRevision===0)await tx.aiConfiguration.create({data:{id:"site",revision:1,payload}});
            else{
                const result=await tx.aiConfiguration.updateMany({where:{id:"site",revision:expectedRevision},data:{payload,revision:{increment:1}}});
                if(result.count!==1)throw Error("CONFIG_CONFLICT");
            }
            await reconcileSiteModelAccess(tx,parsed,true);
        });
    }catch(error){
        if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002")throw Error("CONFIG_CONFLICT");
        throw error;
    }
    return expectedRevision+1;
}
