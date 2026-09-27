import { prisma } from "../prisma";
import { emptyConfig, type PortableConfig } from "../ai-config/schema";
import { requireLiveAiUser, requireTxAiActor } from "./account";
import { protectUserConfig, unprotectUserConfig } from "./private-vault";
import { parsePrivateEdit, privateConfigDTO } from "./private-editor";
import { conflict } from "./errors";
export async function readPrivateConfig(userId:string){
    await requireLiveAiUser(userId);
    const row=await prisma.userAiConfiguration.findUnique({where:{userId}});
    return {revision:row?.revision??0,config:row?unprotectUserConfig(userId,row.payload):emptyConfig()};
}
export async function savePrivateConfig(userId:string,raw:unknown,revision:number,sessionVersion:number){
    const current=await readPrivateConfig(userId);
    if(current.revision!==revision)conflict();
    const config=parsePrivateEdit(raw,current.config);
    return persistPrivateConfig(userId,config,revision,sessionVersion);
}
export async function persistPrivateConfig(userId:string,config:PortableConfig,revision:number,sessionVersion:number){
    const payload=protectUserConfig(userId,config);
    try{
        await prisma.$transaction(async tx=>{
            await requireTxAiActor(tx,userId,sessionVersion);
            if(revision===0){await tx.userAiConfiguration.create({data:{userId,payload}});return;}
            const updated=await tx.userAiConfiguration.updateMany({where:{userId,revision},data:{payload,revision:{increment:1}}});if(updated.count!==1)conflict();
        });
    }catch(error){if(typeof error==="object" && error!==null && "code" in error && error.code==="P2002")conflict();throw error;}
    return {revision:revision+1,config:privateConfigDTO(config)};
}
