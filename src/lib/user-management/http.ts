import {z} from "zod";
import {getServerSession} from "next-auth";
import {authOptions} from "@/lib/auth";
import {requireAdmin,assertSameOrigin,aiJson,aiErrorResponse,readAIJson} from "@/lib/ai-access";
import {UserManagementError} from "./errors";
import {consumeAuthLimit} from "./rate-limit";
import {getLiveUser,isSessionCurrent} from "./live-session";
export {readAIJson as readUserJson};
export async function userResponse(action:()=>Promise<unknown>,status=200){
 try{return aiJson(await action(),status);}catch(error){
  if(error instanceof z.ZodError)return aiJson({error:"INVALID_INPUT"},400);
  if(error instanceof UserManagementError)return aiJson({error:error.code},error.status);
  return aiErrorResponse(error);
 }
}
export async function adminRequest(req:Request,action:(user:{id:string,role:string,sessionVersion:number})=>Promise<unknown>,status=200){
 return userResponse(async()=>{
  const user=await requireAdmin(req);
  if(req.method!=="GET" && req.method!=="HEAD"){
   assertSameOrigin(req);
   if(!await consumeAuthLimit("admin-write:"+user.id,120,60_000))throw new UserManagementError("TOO_MANY_ATTEMPTS",429);
  }
  return action(user);
 },status);
}
/** Allows only the password-change escape hatch for a forced-change session. */
export async function passwordUser(req:Request){
 assertSameOrigin(req);const session=await getServerSession(authOptions);
 const user=session?.user?.id ? await getLiveUser(session.user.id):null;
 if(!user||!session?.user||!isSessionCurrent(user,session.user))throw new UserManagementError("AUTHENTICATION_REQUIRED",401);
 if(!await consumeAuthLimit("password-change:"+user.id,10,15*60_000))throw new UserManagementError("TOO_MANY_ATTEMPTS",429);
 return user;
}
