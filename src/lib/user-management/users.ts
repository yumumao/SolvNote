import {assertEmailAvailable} from "./email-identity";
import {assertAdminActor} from "./admin-actor";
import {ensureInitialAiPolicy} from "@/lib/ai-access/bootstrap";
import {randomBytes} from "node:crypto";
import {hash,compare} from "bcryptjs";
import type {Prisma} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import {createInitialAiGrants} from "@/lib/ai-access/registration";
import {createUserSchema,updateUserSchema,revisionSchema,changePasswordSchema} from "./schema";
import {expirationDate,isAccountExpired} from "./policy";
import {userDto} from "./dto";
import {UserManagementError as E} from "./errors";
export async function createManagedUser(actorId:string,input:unknown,now=new Date(),actorVersion?:number){
 const body=createUserSchema.parse(input),temporaryPassword=randomBytes(24).toString("base64url"),password=await hash(temporaryPassword,12);
 await ensureInitialAiPolicy();
 try{const user=await prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  await assertEmailAvailable(tx,body.email);
  const user=await tx.user.create({data:{email:body.email,name:body.name,role:body.role,password,expiresAt:expirationDate(body.expirationDays,now),mustChangePassword:true,aiAccessInitialized:true}});
  await createInitialAiGrants(tx,user.id);await tx.userAuditEvent.create({data:{actorId,targetId:user.id,action:"user-created"}});return userDto(user);
 });return {user,temporaryPassword};}catch(error){if(error instanceof E)throw error;throw new E("USER_CREATE_REJECTED",400);}
}
async function protectAdmin(tx:Prisma.TransactionClient,id:string,now:Date){
 const target=await tx.user.findUnique({where:{id}});if(!target)throw new E("USER_NOT_FOUND",404);
 if(target.role==="admin" && target.isActive && !isAccountExpired(target,now)){
  const count=await tx.user.count({where:{role:"admin",isActive:true,OR:[{expiresAt:null},{expiresAt:{gt:now}}]}});
  if(count<=1)throw new E("LAST_ADMIN",409);
 }
 return target;
}
export async function updateManagedUser(actorId:string,id:string,input:unknown,now=new Date(),actorVersion?:number){
 const body=updateUserSchema.parse(input);
 if(actorId===id && (body.isActive===false||body.role==="user"||body.expirationDays!==undefined))throw new E("SELF_ACTION_DENIED",409);
 return prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  if(body.isActive===false||body.role==="user"||body.expirationDays!=null)await protectAdmin(tx,id,now);
  const changed=await tx.user.updateMany({where:{id,revision:body.revision},data:{isActive:body.isActive,role:body.role,expiresAt:body.expirationDays===undefined?undefined:expirationDate(body.expirationDays,now),sessionVersion:{increment:1},revision:{increment:1}}});
  if(!changed.count)throw new E("REVISION_CONFLICT",409);
  await tx.userAuditEvent.create({data:{actorId,targetId:id,action:"user-updated-sessions-revoked"}});
  return userDto(await tx.user.findUniqueOrThrow({where:{id}}));
 });
}
export async function deleteUserRows(tx:Prisma.TransactionClient,id:string){
 // Detached jobs have no User FK; delete them explicitly before cascaded learning/private-AI rows.
 await tx.aiJob.deleteMany({where:{userId:id}});await tx.user.delete({where:{id}});
}
export async function deleteManagedUser(actorId:string,id:string,input:unknown,now=new Date(),actorVersion?:number){
 const {revision}=revisionSchema.parse(input);if(actorId===id)throw new E("SELF_ACTION_DENIED",409);
 return prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  const target=await protectAdmin(tx,id,now);if(target.revision!==revision)throw new E("REVISION_CONFLICT",409);
  await deleteUserRows(tx,id);await tx.userAuditEvent.create({data:{actorId,targetId:id,action:"user-deleted"}});return {ok:true};
 });
}
export async function resetManagedPassword(actorId:string,id:string,input:unknown,actorVersion?:number){
 const {revision}=revisionSchema.parse(input);if(actorId===id)throw new E("SELF_ACTION_DENIED",409);
 const temporaryPassword=randomBytes(24).toString("base64url"),password=await hash(temporaryPassword,12);
 await prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  const changed=await tx.user.updateMany({where:{id,revision},data:{password,mustChangePassword:true,sessionVersion:{increment:1},revision:{increment:1}}});if(!changed.count)throw new E("REVISION_CONFLICT",409);
  await tx.userAuditEvent.create({data:{actorId,targetId:id,action:"password-reset-sessions-revoked"}});
 });return {temporaryPassword};
}
export async function changeOwnPassword(id:string,input:unknown,sessionVersion:number){
 const body=changePasswordSchema.parse(input),user=await prisma.user.findUnique({where:{id}});
 if(!user||!user.isActive||isAccountExpired(user)||user.sessionVersion!==sessionVersion||!await compare(body.currentPassword,user.password))throw new E("PASSWORD_CHANGE_REJECTED",403);
 if(body.currentPassword===body.newPassword)throw new E("PASSWORD_MUST_CHANGE");
 const password=await hash(body.newPassword,12);
 const changed=await prisma.user.updateMany({where:{id,sessionVersion,revision:user.revision,isActive:true},data:{password,mustChangePassword:false,sessionVersion:{increment:1},revision:{increment:1}}});
 if(!changed.count)throw new E("SESSION_REVOKED",401);return {ok:true};
}
