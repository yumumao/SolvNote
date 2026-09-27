import { aiJson, requireAdmin } from "@/lib/ai-access";
import { readSiteAccessPolicy, updateSiteAccessPolicy } from "@/lib/ai-access/admin-store";
import { accessError } from "@/lib/ai-access/errors";
import { readAccessMutation } from "@/lib/ai-access/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){try{await requireAdmin(req);return aiJson(await readSiteAccessPolicy());}catch(e){return accessError(e);}}
export async function PATCH(req:Request){try{const user=await requireAdmin(req);const body=await readAccessMutation(req,user.id,"policy");return aiJson(await updateSiteAccessPolicy(user.id,body,user.sessionVersion));}catch(e){return accessError(e);}}
