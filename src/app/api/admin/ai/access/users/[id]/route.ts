import { z } from "zod";
import { aiJson, requireAdmin } from "@/lib/ai-access";
import { readUserSiteGrants, updateUserSiteGrants } from "@/lib/ai-access/admin-store";
import { accessError } from "@/lib/ai-access/errors";
import { readAccessMutation } from "@/lib/ai-access/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
const userId=z.string().min(1).max(160);
export async function GET(req:Request,ctx:Context){try{await requireAdmin(req);const id=userId.parse((await ctx.params).id);return aiJson(await readUserSiteGrants(id));}catch(e){return accessError(e);}}
export async function PATCH(req:Request,ctx:Context){try{const user=await requireAdmin(req);const id=userId.parse((await ctx.params).id);const body=await readAccessMutation(req,user.id,"grants");return aiJson(await updateUserSiteGrants(user.id,id,body,user.sessionVersion));}catch(e){return accessError(e);}}
