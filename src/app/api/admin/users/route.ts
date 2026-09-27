import {prisma} from "@/lib/prisma";
import {adminRequest,readUserJson} from "@/lib/user-management/http";
import {createManagedUser} from "@/lib/user-management/users";
export const dynamic="force-dynamic";
export async function GET(req:Request){return adminRequest(req,()=>prisma.user.findMany({orderBy:{createdAt:"desc"},take:1000,select:{id:true,name:true,email:true,role:true,isActive:true,expiresAt:true,mustChangePassword:true,revision:true,createdAt:true,educationStage:true,enrollmentYear:true,_count:{select:{errorItems:true,practiceRecords:true}}}}));}
export async function POST(req:Request){return adminRequest(req,async user=>createManagedUser(user.id,await readUserJson(req,16*1024),new Date(),user.sessionVersion),201);}
