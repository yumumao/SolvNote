import sharp from "sharp";
import type {JobInput} from "../ai-jobs/schema";
import {AIError} from "../ai/transport";
import {callChain} from "../ai/chain";
import {aiRun} from "../ai-jobs/context";
import {requireLiveAiUser} from "../ai-access/account";
import {parseJSON} from "../ai-dialogue/protocol";
import {IllustrationDescriptionSchema,ILLUSTRATION_DESCRIPTION_PROMPT,type IllustrationDescriptionResult} from "./illustration-reference";
export async function validateDescriptionInput(input:JobInput){
    if(!input.confirmDescription || !input.imageBase64 || input.questionText.trim() || input.originalImageBase64 || input.drawingPlan || input.drawingPreviousBase || input.errorItemId || input.answerText || input.analysis || input.drawingCorrection || input.review || input.mode!=="direct" || input.confirmIllustration || input.confirmImageEdit)throw Error("INVALID_REQUEST");
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageBase64);
    if(!match || match[2].length>8*1024*1024)throw Error("INVALID_REQUEST");
    try{
        const bytes=Buffer.from(match[2],"base64");if(bytes.toString("base64")!==match[2])throw Error();
        const image=sharp(bytes,{limitInputPixels:16000000,failOn:"error"});const meta=await image.metadata();
        if(meta.format!==match[1] || (meta.pages||1)!==1)throw Error();
        await image.resize({width:32,height:32,fit:"inside"}).raw().toBuffer();
    }catch{throw Error("INVALID_REQUEST");}
}
export function parseIllustrationDescription(raw:string){
    try{return parseJSON(raw,IllustrationDescriptionSchema);}catch{throw new AIError("AI_DESCRIPTION_INVALID");}
}
export async function executeDescription(input:JobInput):Promise<IllustrationDescriptionResult>{
    const run=aiRun.getStore();if(!run?.userId||!run.jobId)throw new AIError("AI_INTERNAL_ERROR");
    if((await requireLiveAiUser(run.userId)).role!=="admin")throw new AIError("AI_ACCESS_REVOKED");
    await validateDescriptionInput(input);
    const result=await callChain(ILLUSTRATION_DESCRIPTION_PROMPT,"请只描述附图中明确可见的内容。",input.imageBase64,parseIllustrationDescription,{role:"recognize",stage:"illustration_describe",singleAttempt:true});
    return {type:"illustration_description",...result};
}
