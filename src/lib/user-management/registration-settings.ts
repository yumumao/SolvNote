import {assertAdminActor} from "./admin-actor";
import {ensureInitialAiPolicy} from "@/lib/ai-access/bootstrap";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {masterKey,protect,unprotect} from "@/lib/ai-config/vault";
import {getTurnstilePublicConfig} from "@/lib/security/turnstile";
import {DAY_MS} from "./policy";
import {UserManagementError as E} from "./errors";
import {registrationSettingsSchema,inviteCreateSchema,inviteUpdateSchema} from "./schema";
import {inviteDto,settingsDto} from "./dto";
export const hashInvite=(code:string)=>createHash("sha256").update(code.trim()).digest("hex");
export async function getRegistrationSettings(){return prisma.registrationSettings.upsert({where:{id:"site"},create:{id:"site"},update:{}});}
export async function saveRegistrationSettings(actorId:string,input:unknown,actorVersion?:number){
 const {revision,...patch}=registrationSettingsSchema.parse(input);
 if(patch.enabled===true && !getTurnstilePublicConfig().turnstileConfigured)throw new E("TURNSTILE_NOT_CONFIGURED",503);
 if(patch.enabled===true)await ensureInitialAiPolicy();
 await getRegistrationSettings();
 return prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  const changed=await tx.registrationSettings.updateMany({where:{id:"site",revision},data:{...patch,revision:{increment:1}}});
  if(!changed.count)throw new E("REVISION_CONFLICT",409);
  const current=await tx.registrationSettings.findUniqueOrThrow({where:{id:"site"}});
  if(current.inviteDisplayEnabled && current.displayedInviteId){const invite=await tx.invitationCode.findUnique({where:{id:current.displayedInviteId}});if(!invite)throw new E("INVITE_NOT_FOUND",404);}
  await tx.userAuditEvent.create({data:{actorId,action:"registration-policy-updated"}});
  return settingsDto(current);
 });
}
export async function createInvite(actorId:string,input:unknown,now=new Date(),actorVersion?:number){
 const body=inviteCreateSchema.parse(input),id=randomUUID(),code=randomBytes(24).toString("base64url");
 masterKey(true);
 const row=await prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  return tx.invitationCode.create({data:{id,codeHash:hashInvite(code),encryptedCode:protect({kind:"registration-invite",id,code}),maxUses:body.maxUses,expiresAt:new Date(now.getTime()+body.lifetimeDays*DAY_MS),createdById:actorId}});
 });
 return {invite:inviteDto(row),code};
}
export async function updateInvite(actorId:string,id:string,input:unknown,now=new Date(),actorVersion?:number){
 const body=inviteUpdateSchema.parse(input);
 return prisma.$transaction(async tx=>{
  await assertAdminActor(tx,actorId,actorVersion);
  const current=await tx.invitationCode.findUnique({where:{id}});if(!current)throw new E("INVITE_NOT_FOUND",404);
  if(body.maxUses!==undefined && body.maxUses<current.usedCount)throw new E("INVALID_INVITE_LIMIT");
  const expiresAt=body.renewDays ? new Date(Math.max(now.getTime(),current.expiresAt.getTime())+body.renewDays*DAY_MS) : undefined;
  const changed=await tx.invitationCode.updateMany({where:{id,revision:body.revision},data:{enabled:body.enabled,maxUses:body.maxUses,expiresAt,revision:{increment:1}}});
  if(!changed.count)throw new E("REVISION_CONFLICT",409);
  await tx.userAuditEvent.create({data:{actorId,targetId:id,action:body.enabled===false?"invite-disabled":"invite-updated"}});
  return inviteDto(await tx.invitationCode.findUniqueOrThrow({where:{id}}));
 });
}
export async function publicRegistrationStatus(now=new Date()){
 const policy=await getRegistrationSettings(),turnstile=getTurnstilePublicConfig();let inviteCode:string|null=null;
 if(policy.enabled && policy.inviteRequired && policy.inviteDisplayEnabled && policy.displayedInviteId){
  const row=await prisma.invitationCode.findUnique({where:{id:policy.displayedInviteId}});
  if(row?.enabled && row.expiresAt>now && row.usedCount<row.maxUses){
   try{const opened=unprotect<{kind:string,id:string,code:string}>(row.encryptedCode);if(opened.kind==="registration-invite" && opened.id===row.id && hashInvite(opened.code)===row.codeHash)inviteCode=opened.code;}catch{/* corrupted/unavailable vault must not expose anything */}
  }
 }
 return {enabled:policy.enabled && turnstile.turnstileConfigured,inviteRequired:policy.inviteRequired,inviteCode,...turnstile};
}
