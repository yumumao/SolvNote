import {z} from "zod";
import {compare} from "bcryptjs";
import {prisma} from "@/lib/prisma";
import {verifyTurnstileToken} from "@/lib/security/turnstile";
import {limitAuthentication,requestIp} from "./rate-limit";
import {isAccountExpired} from "./policy";
import {findUniqueEmailIdentity} from "./email-identity";
const credentialsSchema=z.object({email:z.string().trim().min(3).max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(256),turnstileToken:z.string().min(1).max(2048)});
/** Generic failure; never log a submitted credential or upstream response. */
export async function authenticateCredentials(input:unknown,headers?:Headers){
 try{
  const parsed=credentialsSchema.safeParse(input);if(!parsed.success)return null;
  const {email,password,turnstileToken}=parsed.data,remoteIp=headers?requestIp(headers):undefined;
  if(!await limitAuthentication("login",email,remoteIp))return null;
  if(!await verifyTurnstileToken(turnstileToken,{expectedAction:"login",remoteIp}))return null;
  const user=await prisma.$transaction(async tx=>{
   const identity=await findUniqueEmailIdentity(tx,email);
   return identity ? tx.user.findUnique({where:{id:identity.id}}) : null;
  });
  if(!user||!user.isActive||isAccountExpired(user)||!await compare(password,user.password))return null;
  return {id:user.id,email:user.email,name:user.name,role:user.role,sessionVersion:user.sessionVersion,mustChangePassword:user.mustChangePassword};
 }catch{return null;}
}
