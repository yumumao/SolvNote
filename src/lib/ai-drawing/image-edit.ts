import sharp from "sharp";
import type {AIProvider,AIModel} from "../ai-config/schema";
import {AIError,buildRequest} from "../ai/transport";
import {AIUrlError,withSafeAIResponse} from "../ai-url";
export function buildImageEditRequest(p:AIProvider,m:AIModel,prompt:string,image:string){
    if(p.protocol!=="gemini" || !image)throw new AIError("AI_IMAGE_EDIT_UNSUPPORTED");
    const req=buildRequest(p,m,"只编辑用户提供的几何题图，保留原题和标注。禁止改变原有数学条件。",prompt,image);
    return {...req,body:{...req.body,generationConfig:{responseModalities:["TEXT","IMAGE"]}}};
}
export async function decodeEditedImage(raw:unknown):Promise<string>{
    const v=raw as {candidates?:Array<{finishReason?:string;content?:{parts?:Array<{thought?:boolean;inlineData?:{mimeType?:string;data?:string}}>}}>};
    const candidate=v?.candidates?.[0];
    if(!candidate || (candidate.finishReason && candidate.finishReason!=="STOP"))throw new AIError("AI_IMAGE_EDIT_NO_IMAGE");
    const image=candidate.content?.parts?.find(p=>!p.thought && p.inlineData)?.inlineData;
    if(!image || !["image/png","image/jpeg","image/webp"].includes(image.mimeType||"") || typeof image.data!=="string" || image.data.length>14*1024*1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw new AIError("AI_IMAGE_EDIT_NO_IMAGE");
    try {
        const source=sharp(Buffer.from(image.data,"base64"),{limitInputPixels:16000000,failOn:"error"});
        const meta=await source.metadata();
        if(!["png","jpeg","webp"].includes(meta.format||"") || (meta.pages||1)>1)throw Error();
        const png=await source.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).png().toBuffer();
        if(png.length>8*1024*1024)throw Error();
        return `data:image/png;base64,${png.toString("base64")}`;
    }catch{throw new AIError("AI_IMAGE_EDIT_INVALID_IMAGE");}
}
export async function sendImageEdit(p:AIProvider,m:AIModel,prompt:string,image:string,signal:AbortSignal){
    const req=buildImageEditRequest(p,m,prompt,image);
    try {
        return await withSafeAIResponse(req.url,{method:"POST",headers:req.headers,body:JSON.stringify(req.body),signal,redirect:"error"},async res=>{
            if(!res.ok)throw new AIError(res.status===429?"AI_RATE_LIMIT":res.status===401||res.status===403?"AI_AUTH_ERROR":`AI_HTTP_${res.status}`);
            let data:unknown;try{data=await res.json();}catch{throw new AIError("AI_ACCEPTANCE_UNKNOWN");}
            return decodeEditedImage(data);
        },"image");
    }catch(e){if(e instanceof AIError)throw e;if(e instanceof AIUrlError)throw new AIError("AI_ENDPOINT_REJECTED");throw new AIError("AI_ACCEPTANCE_UNKNOWN");}
}
