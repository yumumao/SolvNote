import {assertEmailAvailable} from "./email-identity";
import {ensureInitialAiPolicy} from "@/lib/ai-access/bootstrap";
import {hash} from "bcryptjs";
import {prisma} from "@/lib/prisma";
import {verifyTurnstileToken} from "@/lib/security/turnstile";
import {createInitialAiGrants} from "@/lib/ai-access/registration";
import {registrationSchema} from "./schema";
import {getRegistrationSettings,hashInvite} from "./registration-settings";
import {expirationDate} from "./policy";
import {limitAuthentication} from "./rate-limit";
import {userDto} from "./dto";
import {UserManagementError as E} from "./errors";
export async function registerUser(input:unknown,meta:{remoteIp?:string}={},now=new Date()){
 const body=registrationSchema.parse(input),policy=await getRegistrationSettings();
 if(!policy.enabled)throw new E("REGISTRATION_DISABLED",403);
 if(!await limitAuthentication("register",body.email,meta.remoteIp))throw new E("TOO_MANY_ATTEMPTS",429);
 if(!await verifyTurnstileToken(body.turnstileToken,{expectedAction:"register",remoteIp:meta.remoteIp}))throw new E("VERIFICATION_FAILED",403);
 await ensureInitialAiPolicy();
 const password=await hash(body.password,12);
 try{return await prisma.$transaction(async tx=>{
  const current=await tx.registrationSettings.findUniqueOrThrow({where:{id:"site"}});
  if(!current.enabled)throw new E("REGISTRATION_DISABLED",403);
  // Keep existence/case conflicts indistinguishable from other registration rejection.
  try { await assertEmailAvailable(tx,body.email); } catch { throw new E("REGISTRATION_REJECTED",400); }
  let inviteId:string|undefined;
  if(current.inviteRequired){
   if(!body.inviteCode)throw new E("REGISTRATION_REJECTED",400);
   const invite=await tx.invitationCode.findUnique({where:{codeHash:hashInvite(body.inviteCode)}});
   if(!invite||!invite.enabled||invite.expiresAt<=now||invite.usedCount>=invite.maxUses)throw new E("REGISTRATION_REJECTED",400);
   const claimed=await tx.invitationCode.updateMany({where:{id:invite.id,enabled:true,usedCount:invite.usedCount,expiresAt:{gt:now}},data:{usedCount:{increment:1}}});
   if(!claimed.count)throw new E("REGISTRATION_REJECTED",400);inviteId=invite.id;
  }
  const user=await tx.user.create({data:{email:body.email,name:body.name,password,educationStage:body.educationStage,enrollmentYear:body.enrollmentYear,expiresAt:expirationDate(current.defaultExpirationDays,now),aiAccessInitialized:true}});
  if(inviteId)await tx.invitationUse.create({data:{userId:user.id,inviteId}});
  await createInitialAiGrants(tx,user.id);
  await tx.userAuditEvent.create({data:{targetId:user.id,action:"user-registered"}});
  return userDto(user);
 },{timeout:10000});}catch(error){if(error instanceof E)throw error;throw new E("REGISTRATION_REJECTED",400);}
}
