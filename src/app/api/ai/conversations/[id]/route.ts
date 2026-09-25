import { z } from "zod";
import { requireUser, assertSameOrigin, aiJson } from "@/lib/ai-access";
import { readJSON } from "@/lib/ai-http";
import { actConversation, readConversation, deleteConversation } from "@/lib/ai-dialogue/store";
import { dialogueHTTPError } from "@/lib/ai-dialogue/http";
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:Context){
    try{
        const u=await requireUser(req),{id}=await params;
        const c=await readConversation(u.id,id,new URL(req.url).searchParams.get("restore")==="1");
        return aiJson(c || {message:"NOT_FOUND"},c?200:404);
    }catch(e){return dialogueHTTPError(e);}
}
export async function POST(req:Request,{params}:Context){
    try{
        const u=await requireUser(req);assertSameOrigin(req);const {id}=await params;
        await actConversation(u.id,id,await readJSON(req,25*1024*1024),req.headers.get("x-request-id") || "");
        return aiJson({ok:true});
    }catch(e){return dialogueHTTPError(e);}
}
export async function DELETE(req:Request,{params}:Context){
    try{
        const u=await requireUser(req);assertSameOrigin(req);const {id}=await params;
        const {revision}=z.object({revision:z.number().int().min(0)}).strict().parse(await readJSON(req));
        await deleteConversation(u.id,id,revision);return aiJson({ok:true});
    }catch(e){return dialogueHTTPError(e);}
}
