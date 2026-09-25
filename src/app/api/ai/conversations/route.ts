import { requireUser, assertSameOrigin, aiJson } from "@/lib/ai-access";
import { prisma } from "@/lib/prisma";
import { readJSON } from "@/lib/ai-http";
import { createConversation } from "@/lib/ai-dialogue/store";
import { dialogueHTTPError } from "@/lib/ai-dialogue/http";
export async function GET(req: Request) {
    try {
        const u=await requireUser(req);
        const conversations=await prisma.aiConversation.findMany({where:{userId:u.id},orderBy:{updatedAt:"desc"},take:100,
            select:{id:true,state:true,roundsUsed:true,roundLimit:true,updatedAt:true}});
        return aiJson({conversations});
    }catch(e){return dialogueHTTPError(e);}
}
export async function POST(req: Request) {
    try {
        const u=await requireUser(req);assertSameOrigin(req);
        const id=await createConversation(u.id,await readJSON(req,25*1024*1024),req.headers.get("x-request-id") || "");
        return aiJson({id},201);
    }catch(e){return dialogueHTTPError(e);}
}
