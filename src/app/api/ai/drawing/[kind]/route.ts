import {enqueue} from "@/lib/ai-jobs/enqueue";
import {aiJson} from "@/lib/ai-access";
export async function POST(req:Request,context:{params:Promise<{kind:string}>}){
    const {kind}=await context.params;
    if(kind!=="construction"&&kind!=="image_edit")return aiJson({message:"NOT_FOUND"},404);
    return enqueue(req,kind);
}
