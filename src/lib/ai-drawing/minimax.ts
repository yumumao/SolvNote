import sharp from "sharp";
import type {AIProvider} from "../ai-config/schema";
import {AIError} from "../ai/transport";
import {AIUrlError,withSafeAIResponse} from "../ai-url";
import {IllustrationInput,miniMaxEndpoint,type IllustrationRequest} from "./illustration-schema";
export function buildMiniMaxRequest(provider:AIProvider,input:IllustrationRequest){
    const data=IllustrationInput.parse(input),url=miniMaxEndpoint(provider.baseUrl);
    if(!url||!provider.enabled||!provider.apiKey)throw new AIError("AI_ILLUSTRATION_ENDPOINT");
    return {url,headers:{"Content-Type":"application/json",Authorization:`Bearer ${provider.apiKey}`},body:{model:data.model,prompt:data.prompt,aspect_ratio:data.ratio,n:1,response_format:"base64",prompt_optimizer:false,aigc_watermark:true}};
}
export async function decodeMiniMaxImage(raw:unknown):Promise<string>{
    const value=raw as {base_resp?:{status_code?:number};data?:{image_base64?:unknown[]}}|null;
    if(value?.base_resp?.status_code!==0)throw new AIError("AI_ILLUSTRATION_UPSTREAM");
    const images=value.data?.image_base64;
    if(!Array.isArray(images)||images.length!==1)throw new AIError("AI_ILLUSTRATION_NO_IMAGE");
    const image=images[0];
    if(typeof image!=="string"||!image.length||image.length>14*1024*1024||image.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))throw new AIError("AI_ILLUSTRATION_INVALID_IMAGE");
    try{
        const bytes=Buffer.from(image,"base64");
        if(bytes.toString("base64")!==image)throw Error();
        const source=sharp(bytes,{limitInputPixels:16000000,failOn:"error"});
        const meta=await source.metadata();
        if(!["png","jpeg","webp"].includes(meta.format||"")||(meta.pages||1)>1)throw Error();
        const png=await source.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).png().toBuffer();
        if(png.length>8*1024*1024)throw Error();
        return `data:image/png;base64,${png.toString("base64")}`;
    }catch{throw new AIError("AI_ILLUSTRATION_INVALID_IMAGE");}
}
export async function sendMiniMaxImage(provider:AIProvider,input:IllustrationRequest,signal:AbortSignal){
    const request=buildMiniMaxRequest(provider,input);
    signal.throwIfAborted();
    try{
        return await withSafeAIResponse(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(request.body),signal,redirect:"error"},async response=>{
            if(!response.ok)throw new AIError(response.status===429?"AI_RATE_LIMIT":[401,403].includes(response.status)?"AI_AUTH_ERROR":`AI_HTTP_${response.status}`);
            let data:unknown;try{data=await response.json();}catch{throw new AIError("AI_ACCEPTANCE_UNKNOWN");}
            return decodeMiniMaxImage(data);
        },"image");
    }catch(error){if(error instanceof AIError)throw error;if(error instanceof AIUrlError)throw new AIError("AI_ENDPOINT_REJECTED");throw new AIError("AI_ACCEPTANCE_UNKNOWN");}
}
