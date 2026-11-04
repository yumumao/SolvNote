import { aiJson, requireUser } from "@/lib/ai-access";
import { accessError } from "@/lib/ai-access/errors";
import { readAccessMutation } from "@/lib/ai-access/http";
import { saveUserModelOrder } from "@/lib/ai-access/order-store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function PATCH(req:Request){try{
    const user=await requireUser(req);
    await saveUserModelOrder(user.id,await readAccessMutation(req,user.id,"private"),user.sessionVersion);
    return aiJson({ok:true});
}catch(e){return accessError(e);}}
