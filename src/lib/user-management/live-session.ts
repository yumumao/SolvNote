import {prisma} from "@/lib/prisma";
import {isAccountExpired} from "./policy";
export async function getLiveUser(id:string,now=new Date()){
 if(!id)return null;
 const user=await prisma.user.findUnique({where:{id},select:{id:true,role:true,isActive:true,expiresAt:true,sessionVersion:true,mustChangePassword:true,revision:true,aiAccessInitialized:true}});
 return user && user.isActive && !isAccountExpired(user,now) ? user : null;
}
export function isSessionCurrent(user:{sessionVersion:number},session:{sessionVersion?:unknown}):boolean{
 return (session.sessionVersion ?? 0) === user.sessionVersion;
}
