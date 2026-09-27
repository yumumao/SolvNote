import { AIRequestError } from "../ai-access";
import { getLiveUser } from "../user-management/live-session";
import type { AiAccessTx } from "./types";
export async function requireLiveAiUser(userId:string){
    const user=await getLiveUser(userId);
    if(!user || user.mustChangePassword)throw new AIRequestError(403,"AI_ACCESS_REVOKED");
    return user;
}
export async function requireTxAiUser(tx:AiAccessTx,userId:string,admin=false){
    const user=await tx.user.findUnique({where:{id:userId},select:{id:true,role:true,isActive:true,expiresAt:true,mustChangePassword:true,aiAccessInitialized:true,sessionVersion:true}});
    if(!user?.isActive || user.mustChangePassword || (user.expiresAt!==null && user.expiresAt<=new Date()) || (admin && user.role!=="admin"))throw new AIRequestError(403,"AI_ACCESS_REVOKED");
    return user;
}

/** Bind the committing mutation to the exact session authenticated before reading its body. */
export async function requireTxAiActor(tx:AiAccessTx,userId:string,sessionVersion:number,admin=false){
    const user=await requireTxAiUser(tx,userId,admin);
    if(!Number.isSafeInteger(sessionVersion) || sessionVersion<0 || user.sessionVersion!==sessionVersion)throw new AIRequestError(403,"AI_ACCESS_REVOKED");
    return user;
}
