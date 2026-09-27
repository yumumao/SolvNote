import {prisma} from "@/lib/prisma";
import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {createInvite} from "@/lib/user-management/registration-settings";
export const dynamic="force-dynamic";
export async function GET(req:Request){return adminRequest(req,()=>prisma.invitationCode.findMany({orderBy:{createdAt:"desc"},take:500,select:{id:true,maxUses:true,usedCount:true,expiresAt:true,enabled:true,revision:true,createdAt:true}}));}
export async function POST(req:Request){return adminRequest(req,async user=>createInvite(user.id,await readUserJson(req,8192),new Date(),user.sessionVersion),201);}
